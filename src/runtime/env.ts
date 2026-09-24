import { existsSync } from 'node:fs';
import { installFetchInterceptor } from '../interceptors/fetch.js';
import { readTapeFile, writeTapeFile } from '../tape/io.js';
import type { TapeOutcome } from '../tape/schema.js';
import { defaultMetadata } from '../version.js';
import { runtime } from './context.js';
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
  /** Extra comma-separated hosts to treat as LLM APIs, e.g. "localhost:11434". */
  llmHosts: 'TAPEDECK_LLM_HOSTS',
  /** Comma-separated non-LLM hosts whose fetch calls are recorded as tools. */
  httpHosts: 'TAPEDECK_HTTP_HOSTS',
} as const;

/**
 * Detaches the session and hands over the exit code before any other exit
 * listener runs: other tools' exit hooks (e.g. a TypeScript loader flushing
 * its cache) read the clock too, and those reads must not land on the tape.
 */
function onExit(write: (code: number) => void): void {
  process.prependListener('exit', (code) => {
    runtime.globalSession = null;
    write(code);
  });
}

/**
 * The CLI's preload runs in every Node process of the command's process
 * tree — including wrappers such as npx or tsx that make no LLM calls and
 * exit last. A process only writes the tape if it actually made calls, or
 * if nothing has been written yet, so wrappers never clobber the real tape.
 */
function shouldWrite(session: RecordSession | ReplaySession, output: string): boolean {
  const madeCalls = session.recorder.events.some((e) => e.type === 'llm_call' || e.type === 'tool_call');
  return madeCalls || !existsSync(output);
}

function outcomeFor(exitCode: number): TapeOutcome {
  return { status: exitCode === 0 ? 'ok' : 'error', exitCode };
}

/**
 * If this process was launched by `tapedeck record` or `tapedeck replay
 * --against`, starts a process-wide session and writes its tape when the
 * process exits. The CLI preloads TapeDeck into the command, so this runs
 * before any application code; importing `tapedeck` also calls it, which
 * is a no-op once a session is active.
 *
 * @returns true if a session was started
 */
export function activateFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env[ENV.mode];
  if (!mode || runtime.globalSession) return false;
  const settings = Object.fromEntries(Object.entries(ENV).map(([key, name]) => [key, env[name]])) as Record<
    keyof typeof ENV,
    string | undefined
  >;
  const output = settings.output;
  if (!output) throw new Error(`${ENV.mode} is set but ${ENV.output} is missing`);
  installGlobals();
  installFetchInterceptor();

  if (mode === 'record') {
    const session = new RecordSession();
    runtime.globalSession = session;
    onExit((code) => {
      if (!shouldWrite(session, output)) return;
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
    runtime.globalSession = session;
    onExit((code) => {
      if (!shouldWrite(session, output)) return;
      session.finish();
      writeTapeFile(output, session.toTape(outcomeFor(code)));
    });
    return true;
  }

  throw new Error(`Unknown ${ENV.mode} "${mode}" (expected "record" or "replay")`);
}
