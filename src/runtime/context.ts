import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClockReadEvent } from '../tape/schema.js';
import type { LlmCodec, ToolCodec } from './codec.js';

export interface LlmRequest {
  provider: string;
  operation: string;
  request: unknown;
}

/**
 * The hooks every intercepted call goes through. A record session performs
 * the real work and writes it to a tape; a replay session answers from a tape.
 */
export interface Session {
  readonly mode: 'record' | 'replay';
  now(source: ClockReadEvent['source']): number;
  random(): number;
  llm(call: LlmRequest, invoke: () => Promise<unknown>, codec?: LlmCodec): Promise<unknown>;
  tool(name: string, args: unknown, invoke: () => Promise<unknown>, codec?: ToolCodec): Promise<unknown>;
}

interface Store {
  /** `null` means capture is suspended for this async scope. */
  session: Session | null;
}

interface Runtime {
  als: AsyncLocalStorage<Store>;
  /**
   * Process-wide fallback session for CLI-driven runs (see activateFromEnv).
   * Scoped sessions from record()/replay() always take precedence.
   */
  globalSession: Session | null;
  /** The unpatched globals, captured once before anything is patched. */
  originals: { Date: DateConstructor; random: () => number; fetch: typeof fetch | undefined };
  installed: boolean;
  /** State of the fetch interceptor (see interceptors/fetch.ts). */
  fetch: { installed: boolean; llmHosts: Map<string, string>; httpHosts: Set<string> };
}

/**
 * Runtime state lives on globalThis under a registered symbol so that every
 * copy of this module (e.g. a `dist/` build and a `src/` import in the same
 * process) shares one session registry and one set of original globals.
 * Capturing the originals twice would otherwise capture our own patches.
 */
const KEY = Symbol.for('tapedeck.runtime.v1');
const holder = globalThis as typeof globalThis & { [KEY]?: Runtime };

export const runtime: Runtime = (holder[KEY] ??= {
  als: new AsyncLocalStorage<Store>(),
  globalSession: null,
  originals: { Date, random: Math.random, fetch: globalThis.fetch },
  installed: false,
  fetch: { installed: false, llmHosts: new Map(), httpHosts: new Set() },
});

/** The session that should handle a call made right now, if any. */
export function currentSession(): Session | null {
  const store = runtime.als.getStore();
  return store ? store.session : runtime.globalSession;
}

/** Runs `fn` with `session` active for it and everything it awaits. */
export function runInSession<T>(session: Session, fn: () => T): T {
  return runtime.als.run({ session }, fn);
}

/**
 * Runs `fn` with capture suspended. Used around real SDK and tool calls so
 * that their internal clock reads and random draws stay off the tape: those
 * calls are replayed wholesale, so their internals never run on replay.
 */
export function runSuspended<T>(fn: () => T): T {
  return runtime.als.run({ session: null }, fn);
}

/** Real wall-clock time, unaffected by recording or replay. */
export function realNow(): number {
  return runtime.originals.Date.now();
}

/** A real random number, unaffected by recording or replay. */
export function realRandom(): number {
  return runtime.originals.random();
}
