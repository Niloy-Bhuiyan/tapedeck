import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Tape } from './schema.js';
import { TapeFormatError, validateTape } from './validate.js';

export type TapeFileFormat = 'json' | 'jsonl';

/** `.jsonl` files use the line-delimited layout; everything else is plain JSON. */
export function formatForPath(path: string): TapeFileFormat {
  return path.toLowerCase().endsWith('.jsonl') ? 'jsonl' : 'json';
}

/**
 * Serializes a tape.
 *
 * - `json`: one pretty-printed document, easy to read and review in diffs.
 * - `jsonl`: a header line (the tape without `events`) followed by one event
 *   per line, convenient for streaming and for very long runs.
 */
export function serializeTape(tape: Tape, format: TapeFileFormat = 'json'): string {
  if (format === 'json') return `${JSON.stringify(tape, null, 2)}\n`;
  const { events, ...header } = tape;
  return [header, ...events].map((line) => JSON.stringify(line)).join('\n') + '\n';
}

/** Parses either layout (detected from the content) and validates the result. */
export function parseTape(text: string): Tape {
  try {
    return validateTape(JSON.parse(text));
  } catch (error) {
    if (error instanceof TapeFormatError) throw error;
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) throw new TapeFormatError('Invalid tape: file is empty');
  const records = lines.map((line, i) => {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new TapeFormatError(`Invalid tape: line ${i + 1} is not valid JSON`);
    }
  });
  const [header, ...events] = records;
  return validateTape({ ...header, events });
}

export function readTapeFile(path: string): Tape {
  return parseTape(readFileSync(path, 'utf8'));
}

export function writeTapeFile(path: string, tape: Tape, format: TapeFileFormat = formatForPath(path)): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeTape(tape, format));
}
