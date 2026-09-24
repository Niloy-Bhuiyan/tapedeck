import { runInSession } from './runtime/context.js';
import { installGlobals } from './runtime/globals.js';
import { RecordSession } from './runtime/record-session.js';
import { serializeError, toJson } from './tape/json.js';
import type { Tape, TapeMetadata, TapeOutcome } from './tape/schema.js';
import { defaultMetadata } from './version.js';

export interface RecordOptions {
  /** Human label stored on the tape. */
  name?: string;
  /** Extra metadata merged into the tape's metadata. */
  metadata?: TapeMetadata;
  /**
   * Extra patterns to scrub from the tape (replaced with "[REDACTED]"), on
   * top of the built-in API-key and token patterns. Stored on the tape so
   * replays redact live requests the same way.
   */
  redact?: Array<string | RegExp>;
}

/** The recorded tape plus how `fn` ended. Recording never throws on `fn`'s behalf. */
export type RecordResult<T> =
  | { ok: true; result: T; tape: Tape }
  | { ok: false; error: unknown; tape: Tape };

/**
 * Runs `fn` for real and records every intercepted LLM call, tool call,
 * clock read and random draw it makes into a tape.
 *
 * Only calls made within `fn`'s async scope are captured, so concurrent
 * recordings (e.g. parallel tests) do not interfere with each other.
 *
 * @example
 * const { tape } = await record(() => agent.run('question'), { name: 'checkout-flow' });
 * writeTapeFile('tapes/checkout-flow.tape.json', tape);
 */
/** Normalises user-supplied patterns to regex sources (the form stored on tapes). */
export function patternSources(patterns: Array<string | RegExp> | undefined): string[] {
  return (patterns ?? []).map((p) => (typeof p === 'string' ? p : p.source));
}

export async function record<T>(fn: () => T | Promise<T>, options: RecordOptions = {}): Promise<RecordResult<T>> {
  installGlobals();
  const session = new RecordSession({ redact: patternSources(options.redact) });
  const metadata = { ...defaultMetadata(), ...options.metadata };
  const finish = (outcome: TapeOutcome) => session.toTape({ ...(options.name ? { name: options.name } : {}), metadata, outcome });
  try {
    const result = await runInSession(session, fn);
    return { ok: true, result, tape: finish({ status: 'ok', value: toJson(result) }) };
  } catch (error) {
    return { ok: false, error, tape: finish({ status: 'error', error: serializeError(error) }) };
  }
}
