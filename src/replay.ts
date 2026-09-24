import { diffTapes, type DiffOptions, type TapeDiff } from './diff/diff.js';
import { patternSources } from './record.js';
import { runInSession } from './runtime/context.js';
import { installGlobals } from './runtime/globals.js';
import { ReplaySession, type ReplaySessionOptions } from './runtime/replay-session.js';
import { readTapeFile } from './tape/io.js';
import { serializeError, toJson } from './tape/json.js';
import type { Divergence, Tape, TapeOutcome } from './tape/schema.js';

export interface ReplayOptions extends Omit<ReplaySessionOptions, 'redact'> {
  /** Extra redaction patterns; those stored on the tape are always applied. */
  redact?: Array<string | RegExp>;
  /** Options for the diff between the source tape and the replay run. */
  diff?: DiffOptions;
}

export interface ReplayResult<T> {
  /**
   * True when the replay reproduced the tape: no divergences during the run
   * and no differences between the source tape and the replay tape.
   */
  ok: boolean;
  /** Return value of `fn`, when it returned. */
  result?: T;
  /** What `fn` threw, when it threw (including TapeDivergenceError in strict mode). */
  error?: unknown;
  divergences: Divergence[];
  /** The tape that was replayed. */
  expected: Tape;
  /** A tape of what the code actually did during replay. */
  actual: Tape;
  /** Step-by-step comparison of `expected` and `actual`. */
  diff: TapeDiff;
}

/**
 * Runs `fn` against a recorded tape: LLM and tool calls are answered from
 * the tape (no network, no API cost), and the clock and Math.random return
 * the recorded values.
 *
 * @param tape a Tape object or a path to a tape file
 *
 * @example
 * const { ok, divergences } = await replay('tapes/checkout-flow.tape.json', () => agent.run('question'));
 */
export async function replay<T>(
  tape: Tape | string,
  fn: () => T | Promise<T>,
  options: ReplayOptions = {},
): Promise<ReplayResult<T>> {
  installGlobals();
  const expected = typeof tape === 'string' ? readTapeFile(tape) : tape;
  const session = new ReplaySession(expected, { ...options, redact: patternSources(options.redact) });

  let outcome: TapeOutcome;
  let returned: { result: T } | { error: unknown };
  try {
    const result = await runInSession(session, fn);
    outcome = { status: 'ok', value: toJson(result) };
    returned = { result };
  } catch (error) {
    outcome = { status: 'error', error: serializeError(error) };
    returned = { error };
  }

  const divergences = session.finish();
  const actual = session.toTape(outcome);
  const diff = diffTapes(expected, actual, options.diff);
  return { ok: divergences.length === 0 && diff.equal, ...returned, divergences, expected, actual, diff };
}
