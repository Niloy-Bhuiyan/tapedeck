import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatForPath, parseTape, readTapeFile, serializeTape, writeTapeFile } from '../../src/tape/io.js';
import { TapeRecorder } from '../../src/tape/recorder.js';
import { TapeFormatError } from '../../src/tape/validate.js';

function sampleTape() {
  const rec = new TapeRecorder(() => 0);
  rec.append({ type: 'clock_read', source: 'Date.now', value: 42 });
  rec.append({ type: 'llm_call', provider: 'mock', operation: 'op', request: { q: 'hi' }, response: 'yo', durationMs: 1 });
  return rec.toTape({ name: 'sample', outcome: { status: 'ok', value: 'yo' } });
}

describe('tape io', () => {
  it('detects the layout from the file extension', () => {
    expect(formatForPath('a.tape.json')).toBe('json');
    expect(formatForPath('a.tape.JSONL')).toBe('jsonl');
  });

  it.each(['json', 'jsonl'] as const)('round-trips the %s layout', (format) => {
    const tape = sampleTape();
    expect(parseTape(serializeTape(tape, format))).toEqual(tape);
  });

  it('writes one event per line in jsonl', () => {
    const lines = serializeTape(sampleTape(), 'jsonl').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).not.toHaveProperty('events');
    expect(JSON.parse(lines[2]!).type).toBe('llm_call');
  });

  it('tolerates CRLF line endings in jsonl', () => {
    const text = serializeTape(sampleTape(), 'jsonl').replace(/\n/g, '\r\n');
    expect(parseTape(text).events).toHaveLength(2);
  });

  it('reports invalid content clearly', () => {
    expect(() => parseTape('')).toThrow(/file is empty/);
    expect(() => parseTape('{"format":"tapedeck.tape"\nnot json')).toThrow(/line 1 is not valid JSON/);
    expect(() => parseTape('{"format":"nope"}')).toThrow(TapeFormatError);
  });

  it('writes to disk, creating parent directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tapedeck-io-'));
    const path = join(dir, 'nested', 'run.tape.jsonl');
    const tape = sampleTape();
    writeTapeFile(path, tape);
    expect(readFileSync(path, 'utf8').split('\n')[0]).toContain('"format":"tapedeck.tape"');
    expect(readTapeFile(path)).toEqual(tape);
  });
});
