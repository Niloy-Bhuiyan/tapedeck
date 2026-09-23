import type { TapeMetadata } from './tape/schema.js';

/** Package version, written into tape metadata. Kept in sync with package.json (checked by tests). */
export const VERSION = '0.1.0';

/** Metadata stamped on every tape TapeDeck writes. */
export function defaultMetadata(): TapeMetadata {
  return { tapedeckVersion: VERSION, node: process.version };
}
