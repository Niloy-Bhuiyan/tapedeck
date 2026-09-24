import { fileURLToPath } from 'node:url';

// Stack frames name files as URLs or as paths with either kind of slash,
// depending on the loader, so everything is compared in one normalised form.
const normalise = (text: string) => text.split('\\').join('/').toLowerCase();

// This package's own directory (src/ or dist/), as a URL and as a path.
const OWN_DIR = new URL('..', import.meta.url);
const OWN_URL = normalise(OWN_DIR.href);
const OWN_PATH = normalise(fileURLToPath(OWN_DIR));
const NODE_MODULES = /\/node_modules\//;
const FILE_FRAME = /\((?:file:\/\/|[a-z]:\/|\/)|at (?:file:\/\/|[a-z]:\/|\/)/;

/**
 * True when the code that read the clock or drew a random number is
 * application code: the nearest caller outside TapeDeck is a real file that
 * is not inside `node_modules`.
 *
 * Only such reads are recorded. Reads made inside dependencies — an SDK's
 * retry jitter and timeouts, a TypeScript loader tidying its cache, a package
 * manager wrapper — vary with library versions and tooling, and replaying
 * them would only add noise. Those calls simply run for real on replay.
 */
export function calledFromApp(): boolean {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = limit;

  for (const raw of stack.split('\n').slice(1)) {
    const line = normalise(raw);
    if (line.includes(OWN_PATH) || line.includes(OWN_URL)) continue;
    if (line.includes('node:') || !FILE_FRAME.test(line)) continue; // runtime internals, <anonymous>
    return !NODE_MODULES.test(line);
  }
  return false;
}
