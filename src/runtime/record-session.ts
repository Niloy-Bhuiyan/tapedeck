import { serializeError, toJson } from '../tape/json.js';
import { TapeRecorder } from '../tape/recorder.js';
import { compilePatterns, DEFAULT_SECRET_PATTERNS, redactJson } from '../tape/redact.js';
import type { ClockReadEvent, Json, LlmCallEvent, Tape, TapeMetadata, TapeOutcome, ToolCallEvent } from '../tape/schema.js';
import { realNow, realRandom, runSuspended, type LlmRequest, type Session } from './context.js';
import { sdkCodec, valueCodec, type LlmCodec, type ToolCodec } from './codec.js';

/**
 * Makes a real LLM call and fills its outcome into `event`.
 * Shared by recording and by replay's passthrough mode.
 */
export async function executeLlm(
  event: LlmCallEvent,
  call: LlmRequest,
  invoke: () => Promise<unknown>,
  codec: LlmCodec = sdkCodec,
): Promise<unknown> {
  const start = realNow();
  try {
    const live = await runSuspended(invoke);
    const { value, captured } = await runSuspended(() => codec.capture(live, call.request));
    Object.assign(event, captured);
    return value;
  } catch (error) {
    event.error = serializeError(error);
    throw error;
  } finally {
    event.durationMs = realNow() - start;
  }
}

/**
 * Runs a real tool and appends its tool_result to `recorder`.
 * Shared by recording and by replay's passthrough mode.
 */
export async function executeTool(
  recorder: TapeRecorder,
  call: ToolCallEvent,
  invoke: () => Promise<unknown>,
  codec: ToolCodec = valueCodec,
): Promise<unknown> {
  const start = realNow();
  const base = { type: 'tool_result', tool: call.tool, callId: call.callId } as const;
  try {
    const { value, result } = await runSuspended(async () => codec.capture(await invoke()));
    recorder.append({ ...base, result, durationMs: realNow() - start });
    return value;
  } catch (error) {
    recorder.append({ ...base, error: serializeError(error), durationMs: realNow() - start });
    throw error;
  }
}

/**
 * Performs every call for real and writes what happened to a tape.
 * Callers see exactly what they would have seen without TapeDeck.
 */
export interface RecordSessionOptions {
  /** Extra redaction patterns (regex sources), on top of the built-in secret patterns. */
  redact?: string[];
}

export class RecordSession implements Session {
  readonly mode = 'record' as const;
  readonly recorder = new TapeRecorder(realNow);
  private readonly redactSources: string[];

  constructor(options: RecordSessionOptions = {}) {
    this.redactSources = options.redact ?? [];
  }

  now(source: ClockReadEvent['source']): number {
    const value = realNow();
    this.recorder.append({ type: 'clock_read', source, value });
    return value;
  }

  random(): number {
    const value = realRandom();
    this.recorder.append({ type: 'random_draw', value });
    return value;
  }

  llm(call: LlmRequest, invoke: () => Promise<unknown>, codec?: LlmCodec): Promise<unknown> {
    const event = this.recorder.append({
      type: 'llm_call',
      provider: call.provider,
      operation: call.operation,
      request: toJson(call.request),
      durationMs: 0,
    });
    return executeLlm(event, call, invoke, codec);
  }

  tool(name: string, args: unknown, invoke: () => Promise<unknown>, codec?: ToolCodec): Promise<unknown> {
    const call = this.recorder.append({ type: 'tool_call', tool: name, callId: '', args: toJson(args) });
    call.callId = call.id;
    return executeTool(this.recorder, call, invoke, codec);
  }

  /** The recorded tape, with secrets redacted. */
  toTape(options: { name?: string; metadata?: TapeMetadata; outcome?: TapeOutcome } = {}): Tape {
    const metadata = { ...options.metadata, ...(this.redactSources.length ? { redact: this.redactSources } : {}) };
    const tape = this.recorder.toTape({ ...options, metadata });
    return redactJson(tape as unknown as Json, [...DEFAULT_SECRET_PATTERNS, ...compilePatterns(this.redactSources)]) as unknown as Tape;
  }
}
