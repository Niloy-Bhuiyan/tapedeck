import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { diffTapes, type DiffOptions, type TapeDiff } from './diff/diff.js';
import { ENV } from './runtime/env.js';
import type { ReplayMode } from './runtime/replay-session.js';
import { readTapeFile, writeTapeFile } from './tape/io.js';
import type { Divergence, Tape } from './tape/schema.js';

/** Characters to backslash-escape inside double quotes for the platform's shell. */
const QUOTED_SPECIALS = process.platform === 'win32' ? /(")/g : /(["\\$`])/g;

/** Joins argv-style arguments into one shell command line, quoting where needed. */
export function quoteCommand(args: readonly string[]): string {
  return args
    .map((arg) => (/^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(QUOTED_SPECIALS, '\\$1')}"`))
    .join(' ');
}

export interface CommandRun {
  exitCode: number;
  /** Captured output when `stdio: 'pipe'`; empty when inherited. */
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** `inherit` (default) streams the command's output; `pipe` captures it. */
  stdio?: 'inherit' | 'pipe';
  cwd?: string;
}

export class NotInstrumentedError extends Error {
  override name = 'NotInstrumentedError';
  constructor(command: string) {
    super(
      `"${command}" exited without writing a tape. The program must import "tapedeck" ` +
        '(e.g. to use wrapOpenAI/wrapAnthropic/tool) for its calls to be recorded or replayed.',
    );
  }
}

function runCommand(command: string, env: Record<string, string>, options: RunOptions): Promise<CommandRun> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: options.stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, ...env },
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code, signal) => resolvePromise({ exitCode: code ?? (signal ? 128 : 1), stdout, stderr }));
  });
}

function scratchFile(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'tapedeck-')), name);
}

export interface RecordCommandOptions extends RunOptions {
  /** Where to write the tape. */
  output: string;
  /** Name stored on the tape. */
  name?: string;
}

/** Runs `command` for real and records it into a tape (see `tapedeck record`). */
export async function recordCommand(
  command: string,
  options: RecordCommandOptions,
): Promise<CommandRun & { tape: Tape; output: string }> {
  const output = resolve(options.output);
  rmSync(output, { force: true });
  const run = await runCommand(
    command,
    {
      [ENV.mode]: 'record',
      [ENV.output]: output,
      [ENV.command]: command,
      ...(options.name ? { [ENV.name]: options.name } : {}),
    },
    options,
  );
  if (!existsSync(output)) throw new NotInstrumentedError(command);
  return { ...run, tape: readTapeFile(output), output };
}

export interface ReplayCommandOptions extends RunOptions {
  /** The tape to replay, as an object or a file path. */
  tape: Tape | string;
  /** Defaults to `diff` so the full set of differences is reported. */
  mode?: ReplayMode;
  passthrough?: boolean;
  /** Where to write the replay run's tape (a temporary file by default). */
  output?: string;
  diff?: DiffOptions;
}

export interface CommandReplayResult extends CommandRun {
  /** True when the replay reproduced the tape exactly. */
  ok: boolean;
  expected: Tape;
  actual: Tape;
  diff: TapeDiff;
  divergences: Divergence[];
}

/**
 * Runs `command` with its LLM/tool calls, clock and randomness answered from
 * a tape, then diffs what it did against the tape
 * (see `tapedeck replay --against`).
 */
export async function replayCommand(command: string, options: ReplayCommandOptions): Promise<CommandReplayResult> {
  let tapePath: string;
  let expected: Tape;
  if (typeof options.tape === 'string') {
    tapePath = resolve(options.tape);
    expected = readTapeFile(tapePath);
  } else {
    expected = options.tape;
    tapePath = scratchFile('source.tape.json');
    writeTapeFile(tapePath, expected);
  }
  const output = resolve(options.output ?? scratchFile('replay.tape.json'));
  rmSync(output, { force: true });

  const run = await runCommand(
    command,
    {
      [ENV.mode]: 'replay',
      [ENV.tape]: tapePath,
      [ENV.output]: output,
      [ENV.replayMode]: options.mode ?? 'diff',
      ...(options.passthrough ? { [ENV.passthrough]: '1' } : {}),
    },
    options,
  );
  if (!existsSync(output)) throw new NotInstrumentedError(command);

  const actual = readTapeFile(output);
  const divergences = actual.metadata.replay?.divergences ?? [];
  const diff = diffTapes(expected, actual, options.diff);
  return { ...run, ok: divergences.length === 0 && diff.equal, expected, actual, diff, divergences };
}
