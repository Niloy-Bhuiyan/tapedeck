/**
 * Test-framework helpers: replay a tape as a regression test and assert
 * that the current code still behaves exactly as recorded.
 *
 * Works with any framework whose `expect.extend` follows the Jest matcher
 * protocol (Vitest, Jest). For Vitest, import `tapedeck/vitest` instead to
 * get the matcher registered and typed automatically.
 */
import { diffTapes, type DiffOptions, type TapeDiff } from '../diff/diff.js';
import { formatDiff } from '../format/text.js';
import { replayCommand } from '../process.js';
import { replay, type ReplayOptions } from '../replay.js';
import { readTapeFile } from '../tape/io.js';
import type { Divergence, Tape } from '../tape/schema.js';

export interface ReplayTapeOptions extends ReplayOptions {
  /** Replay in-process by running this function against the tape. */
  run?: () => unknown;
  /**
   * Replay by running this shell command against the tape. Defaults to the
   * command the tape was recorded with (`tapedeck record -- <command>`).
   */
  command?: string;
  /** Working directory for `command` (defaults to the current directory). */
  cwd?: string;
}

/** Everything `toMatchTape()` needs to judge a replay. */
export interface TapeReplay {
  ok: boolean;
  expected: Tape;
  actual: Tape;
  diff: TapeDiff;
  divergences: Divergence[];
  /** What the in-process run threw, if anything. */
  error?: unknown;
  /** Output of the replayed command, for command-based replays. */
  stdout?: string;
  stderr?: string;
}

/**
 * Replays a tape against the current code, entirely offline.
 *
 * With a `run` function the replay happens in-process; otherwise the
 * tape's recorded command is re-run as a child process. Replays use `diff`
 * mode by default so a failing test shows every difference, not just the
 * first.
 *
 * @example
 * expect(await replayTape('./tapes/checkout-flow.tape.json')).toMatchTape();
 * expect(await replayTape('./tapes/checkout-flow.tape.json', () => agent.run('buy socks'))).toMatchTape();
 */
export async function replayTape(
  tape: string | Tape,
  runOrOptions: (() => unknown) | ReplayTapeOptions = {},
): Promise<TapeReplay> {
  const options: ReplayTapeOptions = typeof runOrOptions === 'function' ? { run: runOrOptions } : runOrOptions;
  const { run, command, cwd, ...replayOptions } = options;
  const mode = replayOptions.mode ?? 'diff';

  if (run) return replay(tape, run, { ...replayOptions, mode });

  const expected = typeof tape === 'string' ? readTapeFile(tape) : tape;
  const toRun = command ?? expected.metadata.command;
  if (!toRun) {
    throw new Error(
      'replayTape: the tape has no recorded command. Pass a run function, e.g. replayTape(tape, () => agent.run()), or { command }.',
    );
  }
  return replayCommand(toRun, {
    tape: expected,
    mode,
    stdio: 'pipe',
    ...(replayOptions.passthrough ? { passthrough: true } : {}),
    ...(replayOptions.diff ? { diff: replayOptions.diff } : {}),
    ...(cwd ? { cwd } : {}),
  });
}

function isTapeReplay(value: unknown): value is TapeReplay {
  const v = value as Partial<TapeReplay> | null;
  return typeof v === 'object' && v !== null && Array.isArray(v.divergences) && typeof v.diff === 'object' && !!v.expected && !!v.actual;
}

interface MatcherResult {
  pass: boolean;
  message: () => string;
}

function failureMessage(replayed: TapeReplay, diff: TapeDiff): string {
  const name = replayed.expected.name ?? replayed.expected.id;
  const parts = [`Replay of tape "${name}" did not match the recording.`, ''];
  if (replayed.divergences.length) {
    parts.push('Divergences during replay:', ...replayed.divergences.map((d) => `  ! ${d.message}`), '');
  }
  parts.push(formatDiff(diff));
  if (replayed.stderr?.trim()) parts.push('', 'Command stderr:', replayed.stderr.trim());
  return parts.join('\n');
}

/**
 * Matchers for `expect.extend`. `toMatchTape(options?)` passes when the
 * replay made exactly the recorded calls and produced an identical tape.
 * Pass `{ ignoreTypes: ['clock_read'] }` etc. to relax the comparison.
 */
export const tapeMatchers = {
  toMatchTape(received: unknown, options?: DiffOptions): MatcherResult {
    if (!isTapeReplay(received)) {
      return {
        pass: false,
        message: () => 'toMatchTape() expects the result of replayTape() or replay()',
      };
    }
    const diff = options ? diffTapes(received.expected, received.actual, options) : received.diff;
    const pass = diff.equal && received.divergences.length === 0;
    const name = received.expected.name ?? received.expected.id;
    return {
      pass,
      message: () => (pass ? `Expected the replay NOT to match tape "${name}", but it did.` : failureMessage(received, diff)),
    };
  },
};
