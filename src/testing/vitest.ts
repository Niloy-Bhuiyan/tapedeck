/**
 * Vitest integration. Import once (e.g. in a setup file or at the top of a
 * test) to register `toMatchTape()`:
 *
 * @example
 * import { replayTape } from 'tapedeck/vitest';
 *
 * test('checkout flow still behaves as recorded', async () => {
 *   expect(await replayTape('./tapes/checkout-flow.tape.json')).toMatchTape();
 * });
 */
import { expect } from 'vitest';
import type { DiffOptions } from '../diff/diff.js';
import { tapeMatchers } from './index.js';

expect.extend(tapeMatchers);

declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    /** Passes when a replay (from replayTape() or replay()) reproduced its tape exactly. */
    toMatchTape(options?: DiffOptions): R;
  }
}

export * from './index.js';
