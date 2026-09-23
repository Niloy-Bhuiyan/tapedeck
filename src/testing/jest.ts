/**
 * Jest integration. Add to `setupFilesAfterEnv` to register
 * `toMatchTape()` on Jest's global `expect`:
 *
 * @example
 * // jest.config.js
 * export default { setupFilesAfterEnv: ['tapedeck/jest'] };
 *
 * TapeDeck is an ES module, so Jest must run in ESM mode
 * (`NODE_OPTIONS=--experimental-vm-modules`).
 */
import type { DiffOptions } from '../diff/diff.js';
import { tapeMatchers } from './index.js';

declare global {
  namespace jest {
    interface Matchers<R> {
      /** Passes when a replay (from replayTape() or replay()) reproduced its tape exactly. */
      toMatchTape(options?: DiffOptions): R;
    }
  }
}

const globalExpect = (globalThis as { expect?: { extend(matchers: object): void } }).expect;
if (!globalExpect) {
  throw new Error('tapedeck/jest must be loaded inside a Jest test environment (global expect not found)');
}
globalExpect.extend(tapeMatchers);

export * from './index.js';
