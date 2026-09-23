/**
 * The TapeDeck trace format ("tape").
 *
 * A tape is an ordered log of every non-deterministic interaction an agent
 * run had with the outside world: LLM calls, tool calls and their results,
 * clock reads and random draws. Replaying a tape feeds those recorded values
 * back to the code so the run is reproduced exactly, with no network access.
 *
 * See docs/tape-format.md for the full, human-oriented specification.
 */

export const TAPE_FORMAT = 'tapedeck.tape' as const;
export const TAPE_VERSION = 1 as const;

/** Any value that survives a JSON round trip. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type EventType = 'llm_call' | 'tool_call' | 'tool_result' | 'clock_read' | 'random_draw';

export const EVENT_TYPES: readonly EventType[] = [
  'llm_call',
  'tool_call',
  'tool_result',
  'clock_read',
  'random_draw',
];

/** An error captured during recording, re-thrown faithfully on replay. */
export interface SerializedError {
  name: string;
  message: string;
  /** HTTP status for provider errors (e.g. 429), when available. */
  status?: number;
  /** Provider or system error code (e.g. "rate_limit_exceeded"), when available. */
  code?: string;
}

interface EventBase {
  /**
   * Stable event ID derived from the event type, its inputs and how many
   * identical events preceded it. Identical runs produce identical IDs.
   */
  id: string;
  /** Zero-based position of this event in the tape. */
  seq: number;
  /** Milliseconds since the start of the recording (wall clock, informational). */
  t: number;
}

/** HTTP details for LLM calls captured at the network level (fetch). */
export interface HttpMeta {
  status: number;
  /** A safe subset of response headers (content type and retry hints). Never auth headers. */
  headers: Record<string, string>;
}

export interface LlmCallEvent extends EventBase {
  type: 'llm_call';
  /** e.g. "openai", "anthropic", "mock". */
  provider: string;
  /** SDK method path, e.g. "chat.completions.create" or "messages.create". */
  operation: string;
  /** The request body passed to the SDK method. */
  request: Json;
  /** The SDK response. For streamed calls this is the array of chunks. */
  response?: Json;
  /** True when the call was made with `stream: true`. */
  stream?: boolean;
  /** Present for calls captured by the fetch interceptor rather than an SDK wrapper. */
  http?: HttpMeta;
  /** Present when the call threw instead of returning. */
  error?: SerializedError;
  durationMs: number;
}

export interface ToolCallEvent extends EventBase {
  type: 'tool_call';
  tool: string;
  /** Correlates the call with its tool_result; equal to this event's `id`. */
  callId: string;
  args: Json;
}

export interface ToolResultEvent extends EventBase {
  type: 'tool_result';
  tool: string;
  callId: string;
  result?: Json;
  error?: SerializedError;
  durationMs: number;
}

export interface ClockReadEvent extends EventBase {
  type: 'clock_read';
  /** How the clock was read. */
  source: 'Date.now' | 'new Date' | 'Date()';
  /** Epoch milliseconds returned to the code. */
  value: number;
}

export interface RandomDrawEvent extends EventBase {
  type: 'random_draw';
  /** Value in [0, 1) returned by Math.random(). */
  value: number;
}

export type TapeEvent =
  | LlmCallEvent
  | ToolCallEvent
  | ToolResultEvent
  | ClockReadEvent
  | RandomDrawEvent;

/** How the recorded run ended. */
export interface TapeOutcome {
  status: 'ok' | 'error';
  /** Return value of the recorded function (in-process recordings). */
  value?: Json;
  error?: SerializedError;
  /** Process exit code (CLI recordings). */
  exitCode?: number;
}

export interface TapeMetadata {
  tapedeckVersion?: string;
  /** Command line that produced the tape, for `tapedeck record -- <command>`. */
  command?: string;
  /** Node.js version used for the recording. */
  node?: string;
  /** Set on tapes produced by a replay run. */
  replay?: ReplayMetadata;
  [key: string]: Json | ReplayMetadata | undefined;
}

export interface ReplayMetadata {
  /** ID of the tape that was replayed. */
  sourceTapeId: string;
  mode: 'strict' | 'diff';
  divergences: Divergence[];
}

/** A point where replayed code asked for something the tape did not contain. */
export interface Divergence {
  kind: 'unexpected_call' | 'mismatched_call' | 'unconsumed_events';
  message: string;
  /** Event id in the source tape, when one was involved. */
  expectedId?: string;
  /** Event seq in the replay tape, when one was involved. */
  actualSeq?: number;
}

export interface Tape {
  format: typeof TAPE_FORMAT;
  version: typeof TAPE_VERSION;
  /** Unique ID for this recording. */
  id: string;
  name?: string;
  /** ISO-8601 timestamp of when recording started. */
  createdAt: string;
  metadata: TapeMetadata;
  events: TapeEvent[];
  outcome?: TapeOutcome;
}
