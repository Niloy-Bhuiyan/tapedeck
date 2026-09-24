import { deepDiff, describeChange, pathMatcher } from '../diff/deep.js';
import { deserializeError, shortHash, toJson } from '../tape/json.js';
import { TapeRecorder } from '../tape/recorder.js';
import { compilePatterns, DEFAULT_SECRET_PATTERNS, redactJson } from '../tape/redact.js';
import type {
  ClockReadEvent,
  Divergence,
  Json,
  LlmCallEvent,
  RandomDrawEvent,
  Tape,
  TapeOutcome,
  ToolCallEvent,
  ToolResultEvent,
} from '../tape/schema.js';
import { defaultMetadata } from '../version.js';
import { realNow, type LlmRequest, type Session } from './context.js';
import { executeLlm, executeTool } from './record-session.js';
import { sdkCodec, valueCodec, type LlmCodec, type ToolCodec } from './codec.js';

export type ReplayMode = 'strict' | 'diff';

export interface ReplaySessionOptions {
  /**
   * `strict` (default): throw a TapeDivergenceError as soon as the code makes
   * an LLM or tool call that does not match the tape.
   * `diff`: note the divergence and keep going, answering from the tape
   * wherever possible, so every difference in the run can be reported.
   */
  mode?: ReplayMode;
  /**
   * When the code makes a call the tape cannot answer (an extra call, or in
   * diff mode a call whose inputs changed), perform it for real instead of
   * failing. Costs real API calls; off by default.
   */
  passthrough?: boolean;
  /**
   * Extra redaction patterns (regex sources). Patterns stored on the tape are
   * always applied; live requests are redacted the same way before they are
   * compared with the (already redacted) tape.
   */
  redact?: string[];
  /** Request/argument paths to ignore when matching calls (see pathMatcher). */
  ignorePaths?: string[];
}

/** Thrown into the replayed code when it departs from the tape. */
export class TapeDivergenceError extends Error {
  override name = 'TapeDivergenceError';
  constructor(readonly divergence: Divergence) {
    super(divergence.message);
  }
}

/** Small, fast, seedable PRNG (mulberry32) for random draws beyond the tape. */
function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clone = <T extends Json | undefined>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

function summarize(changes: ReturnType<typeof deepDiff>): string {
  const shown = changes.slice(0, 3).map(describeChange).join('; ');
  return changes.length > 3 ? `${shown}; and ${changes.length - 3} more` : shown;
}

/**
 * Answers every call from a tape instead of doing real work.
 *
 * Each kind of event is consumed from its own queue in recorded order:
 * LLM calls and tool calls are matched against the tape (and checked for
 * divergence); clock reads and random draws simply return the recorded
 * values. Once those run out, the clock stays frozen at its last value and
 * random draws continue from a PRNG seeded by the tape ID, so replay stays
 * deterministic even for code that reads the clock more often than before.
 *
 * Everything the replayed code does is itself recorded, producing an
 * "actual" tape that can be diffed against the source tape.
 */
export class ReplaySession implements Session {
  readonly mode = 'replay' as const;
  readonly recorder = new TapeRecorder(realNow);
  readonly divergences: Divergence[] = [];
  readonly replayMode: ReplayMode;
  readonly passthrough: boolean;

  private readonly llmCalls: LlmCallEvent[];
  private readonly toolCalls: ToolCallEvent[];
  private readonly toolResults = new Map<string, ToolResultEvent>();
  private readonly clockReads: ClockReadEvent[];
  private readonly randomDraws: RandomDrawEvent[];
  private lastClock: number;
  private readonly fallbackRandom: () => number;
  private readonly redactSources: string[];
  private readonly patterns: RegExp[];
  private readonly ignorePath: (path: string) => boolean;

  constructor(
    readonly source: Tape,
    options: ReplaySessionOptions = {},
  ) {
    this.replayMode = options.mode ?? 'strict';
    this.passthrough = options.passthrough ?? false;
    const events = source.events;
    this.llmCalls = events.filter((e): e is LlmCallEvent => e.type === 'llm_call');
    this.toolCalls = events.filter((e): e is ToolCallEvent => e.type === 'tool_call');
    this.clockReads = events.filter((e): e is ClockReadEvent => e.type === 'clock_read');
    this.randomDraws = events.filter((e): e is RandomDrawEvent => e.type === 'random_draw');
    for (const e of events) if (e.type === 'tool_result') this.toolResults.set(e.callId, e);
    this.lastClock = Date.parse(source.createdAt);
    this.redactSources = [...new Set([...(source.metadata.redact ?? []), ...(options.redact ?? [])])];
    this.patterns = [...DEFAULT_SECRET_PATTERNS, ...compilePatterns(this.redactSources)];
    this.ignorePath = pathMatcher([...(source.metadata.ignorePaths ?? []), ...(options.ignorePaths ?? [])]);
    this.fallbackRandom = seededRandom(parseInt(shortHash(source.id), 16));
  }

  now(source: ClockReadEvent['source']): number {
    const value = this.clockReads.shift()?.value ?? this.lastClock;
    this.lastClock = value;
    this.recorder.append({ type: 'clock_read', source, value });
    return value;
  }

  random(): number {
    const value = this.randomDraws.shift()?.value ?? this.fallbackRandom();
    this.recorder.append({ type: 'random_draw', value });
    return value;
  }

  async llm(call: LlmRequest, invoke: () => Promise<unknown>, codec: LlmCodec = sdkCodec): Promise<unknown> {
    const request = redactJson(toJson(call.request), this.patterns);
    const actual = this.recorder.append({
      type: 'llm_call',
      provider: call.provider,
      operation: call.operation,
      request,
      durationMs: 0,
    });
    const label = `llm_call ${call.provider} ${call.operation}`;
    const expected = this.llmCalls.shift();

    if (!expected || (expected.response === undefined && !expected.error)) {
      this.unexpected(`${label} (seq ${actual.seq}) has no recorded counterpart on the tape`, actual.seq);
      return executeLlm(actual, call, invoke, codec);
    }

    const changes = deepDiff(
      { provider: expected.provider, operation: expected.operation, request: expected.request },
      { provider: call.provider, operation: call.operation, request },
    ).filter((c) => !this.ignorePath(c.path));
    if (changes.length > 0) {
      this.diverge({
        kind: 'mismatched_call',
        message: `${label} (seq ${actual.seq}) differs from recorded ${expected.id}: ${summarize(changes)}`,
        expectedId: expected.id,
        actualSeq: actual.seq,
      });
      if (this.passthrough) return executeLlm(actual, call, invoke, codec);
    }

    if (expected.error) {
      actual.error = expected.error;
      throw deserializeError(expected.error);
    }
    const captured = {
      response: clone(expected.response) as Json,
      ...(expected.stream ? { stream: true } : {}),
      ...(expected.http ? { http: expected.http } : {}),
    };
    Object.assign(actual, captured);
    return codec.revive(captured);
  }

  async tool(
    name: string,
    args: unknown,
    invoke: () => Promise<unknown>,
    codec: ToolCodec = valueCodec,
  ): Promise<unknown> {
    const jsonArgs = redactJson(toJson(args), this.patterns);
    const call = this.recorder.append({ type: 'tool_call', tool: name, callId: '', args: jsonArgs });
    call.callId = call.id;
    const label = `tool_call "${name}"`;
    const expected = this.toolCalls.shift();
    const recorded = expected && this.toolResults.get(expected.callId);

    if (!expected || !recorded) {
      this.unexpected(`${label} (seq ${call.seq}) has no recorded counterpart on the tape`, call.seq);
      return executeTool(this.recorder, call, invoke, codec);
    }

    const changes = deepDiff({ tool: expected.tool, args: expected.args }, { tool: name, args: jsonArgs }).filter(
      (c) => !this.ignorePath(c.path),
    );
    if (changes.length > 0) {
      this.diverge({
        kind: 'mismatched_call',
        message: `${label} (seq ${call.seq}) differs from recorded ${expected.id}: ${summarize(changes)}`,
        expectedId: expected.id,
        actualSeq: call.seq,
      });
      if (this.passthrough) return executeTool(this.recorder, call, invoke, codec);
    }

    const base = { type: 'tool_result', tool: name, callId: call.callId, durationMs: 0 } as const;
    if (recorded.error) {
      this.recorder.append({ ...base, error: recorded.error });
      throw deserializeError(recorded.error);
    }
    this.recorder.append({ ...base, result: clone(recorded.result) });
    return codec.revive(clone(recorded.result) ?? null);
  }

  /**
   * Records recorded LLM/tool calls the code never made. Call once the
   * replayed code has finished. Returns all divergences seen.
   */
  finish(): Divergence[] {
    const leftover = [...this.llmCalls, ...this.toolCalls].sort((a, b) => a.seq - b.seq);
    if (leftover.length > 0) {
      const names = leftover.map((e) => (e.type === 'tool_call' ? `tool_call "${e.tool}"` : `llm_call ${e.operation}`));
      this.divergences.push({
        kind: 'unconsumed_events',
        message: `${leftover.length} recorded call(s) were never made: ${names.slice(0, 5).join(', ')}${
          names.length > 5 ? ', …' : ''
        }`,
        expectedId: leftover[0]!.id,
      });
      this.llmCalls.length = 0;
      this.toolCalls.length = 0;
    }
    return this.divergences;
  }

  /** The tape of what the replayed code actually did. */
  toTape(outcome?: TapeOutcome): Tape {
    const tape = this.recorder.toTape({
      ...(this.source.name !== undefined ? { name: this.source.name } : {}),
      metadata: {
        ...this.source.metadata,
        ...defaultMetadata(),
        ...(this.redactSources.length ? { redact: this.redactSources } : {}),
        replay: { sourceTapeId: this.source.id, mode: this.replayMode, divergences: this.divergences },
      },
      ...(outcome ? { outcome } : {}),
    });
    return redactJson(tape as unknown as Json, this.patterns) as unknown as Tape;
  }

  private diverge(divergence: Divergence): void {
    this.divergences.push(divergence);
    if (this.replayMode === 'strict') throw new TapeDivergenceError(divergence);
  }

  /** A call the tape cannot answer: fail unless passthrough is enabled. */
  private unexpected(message: string, actualSeq: number): void {
    const divergence: Divergence = { kind: 'unexpected_call', message, actualSeq };
    this.diverge(divergence);
    if (!this.passthrough) throw new TapeDivergenceError(divergence);
  }
}
