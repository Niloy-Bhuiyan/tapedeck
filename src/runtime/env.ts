import { readTapeFile, writeTapeFile } from '../tape/io.js';
import type { TapeOutcome } from '../tape/schema.js';
import { defaultMetadata } from '../version.js';
import { runtime, type Session } from './context.js';
import { installGlobals } from './globals.js';
import { RecordSession } from './record-session.js';
import { ReplaySession } from './replay-session.js';

/**
 * Environment variables the CLI uses to hand a recording or replay to the
 * process it spawns. They are internal plumbing, not a public interface.
 */
export const ENV = {
  /** "record" or "replay". */
  mode: 'TAPEDECK_MODE',
  /** Where to write the tape of this run. */
  output: 'TAPEDECK_OUTPUT',
  /** Replay only: the tape to replay. */
  tape: 'TAPEDECK_TAPE',
  /** Replay only: "strict" or "diff". */
  replayMode: 'TAPEDECK_REPLAY_MODE',
  /** Replay only: "1" to enable passthrough. */
  passthrough: 'TAPEDECK_PASSTHROUGH',
  /** Record only: tape name and command line, stored in the tape. */
  name: 'TAPEDECK_NAME',
  command: 'TAPEDECK_COMMAND',
} as const;

/**
 * Detaches the session and hands over the exit code before any other exit
 * listener runs: other tools' exit hooks (e.g. a TypeScript loader flushing
 * its cache) read the clock too, and those reads must not land on the tape.
 */
function onExit(write: (code: number) => void): void {
  process.prependListener('exit', (code) => {
    runtime.als.enterWith({ session: null });
    write(code);
  });
}

/**
 * Binds `session` to the code that is running now and everything it
 * schedules from here on. Work scheduled earlier (e.g. a loader's pending
 * cache maintenance) keeps its own context and is not captured, which a
 * process-global fallback could not guarantee.
 */
function enter(session: Session): void {
  runtime.als.enterWith({ session });
}

function outcomeFor(exitCode: number): TapeOutcome {
  return { status: exitCode === 0 ? 'ok' : 'error', exitCode };
}

/**
 * If this process was launched by `tapedeck record` or `tapedeck replay
 * --against`, starts a session for the rest of the process and writes its
 * tape when the process exits. Runs automatically when the `tapedeck`
 * package is imported, so the app only has to import TapeDeck (which it
 * does anyway to wrap its clients and tools).
 *
 * @returns true if a session was started
 */
export function activateFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env[ENV.mode];
  if (!mode) return false;
  const settings = Object.fromEntries(Object.entries(ENV).map(([key, name]) => [key, env[name]])) as Record<
    keyof typeof ENV,
    string | undefined
  >;
  // Consume the variables so processes spawned by this one are not
  // recorded into the same file.
  for (const name of Object.values(ENV)) delete env[name];

  const output = settings.output;
  if (!output) throw new Error(`${ENV.mode} is set but ${ENV.output} is missing`);
  installGlobals();

  if (mode === 'record') {
    const session = new RecordSession();
    enter(session);
    onExit((code) => {
      writeTapeFile(
        output,
        session.toTape({
          ...(settings.name ? { name: settings.name } : {}),
          metadata: { ...defaultMetadata(), ...(settings.command ? { command: settings.command } : {}) },
          outcome: outcomeFor(code),
        }),
      );
    });
    return true;
  }

  if (mode === 'replay') {
    if (!settings.tape) throw new Error(`${ENV.mode}=replay requires ${ENV.tape}`);
    const session = new ReplaySession(readTapeFile(settings.tape), {
      mode: settings.replayMode === 'diff' ? 'diff' : 'strict',
      passthrough: settings.passthrough === '1',
    });
    enter(session);
    onExit((code) => {
      session.finish();
      writeTapeFile(output, session.toTape(outcomeFor(code)));
    });
    return true;
  }

  throw new Error(`Unknown ${ENV.mode} "${mode}" (expected "record" or "replay")`);
}
