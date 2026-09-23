import { currentSession, runtime } from './context.js';

/**
 * Replaces `Date` and `Math.random` with thin wrappers that consult the
 * current session. Outside a session (or while capture is suspended) the
 * wrappers delegate straight to the originals, so installing them is safe
 * for the whole process and code outside a recording is unaffected.
 *
 * Only argument-less clock reads are intercepted (`Date.now()`,
 * `new Date()`, `Date()`); `new Date(2020, 0, 1)` and friends are pure.
 */
export function installGlobals(): void {
  if (runtime.installed) return;
  const OriginalDate = runtime.originals.Date;
  const originalRandom = runtime.originals.random;

  function TapeDate(this: unknown, ...args: unknown[]): unknown {
    if (!new.target) {
      // Called as a function: returns the current time as a string.
      const session = currentSession();
      return session ? new OriginalDate(session.now('Date()')).toString() : OriginalDate();
    }
    if (args.length === 0) {
      const session = currentSession();
      if (session) return Reflect.construct(OriginalDate, [session.now('new Date')], new.target);
    }
    // Passing new.target keeps `class X extends Date` working after patching.
    return Reflect.construct(OriginalDate, args, new.target);
  }

  // Share the prototype so `instanceof Date` holds for dates created before
  // and after patching, and inherit the static methods (parse, UTC).
  TapeDate.prototype = OriginalDate.prototype;
  Object.setPrototypeOf(TapeDate, OriginalDate);
  Object.defineProperty(TapeDate, 'name', { value: 'Date' });
  Object.defineProperty(TapeDate, 'length', { value: OriginalDate.length });
  Object.defineProperty(TapeDate, 'now', {
    value: function now(): number {
      const session = currentSession();
      return session ? session.now('Date.now') : OriginalDate.now();
    },
    writable: true,
    configurable: true,
  });

  globalThis.Date = TapeDate as unknown as DateConstructor;
  Math.random = function random(): number {
    const session = currentSession();
    return session ? session.random() : originalRandom();
  };
  runtime.installed = true;
}

/** Restores the original `Date` and `Math.random`. */
export function uninstallGlobals(): void {
  if (!runtime.installed) return;
  globalThis.Date = runtime.originals.Date;
  Math.random = runtime.originals.random;
  runtime.installed = false;
}
