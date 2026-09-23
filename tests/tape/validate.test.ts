import { describe, expect, it } from 'vitest';
import { TapeFormatError, validateTape } from '../../src/tape/validate.js';

function validTape(): Record<string, unknown> {
  return {
    format: 'tapedeck.tape',
    version: 1,
    id: 'tape-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    metadata: {},
    events: [
      { id: 'clock_read:aaaa:0', seq: 0, t: 0, type: 'clock_read', source: 'Date.now', value: 1 },
      {
        id: 'llm_call:bbbb:0',
        seq: 1,
        t: 1,
        type: 'llm_call',
        provider: 'mock',
        operation: 'op',
        request: {},
        response: {},
        durationMs: 3,
      },
      { id: 'tool_call:cccc:0', seq: 2, t: 2, type: 'tool_call', tool: 'calc', callId: 'tool_call:cccc:0', args: '1+1' },
      {
        id: 'tool_result:dddd:0',
        seq: 3,
        t: 3,
        type: 'tool_result',
        tool: 'calc',
        callId: 'tool_call:cccc:0',
        result: 2,
        durationMs: 0,
      },
      { id: 'random_draw:eeee:0', seq: 4, t: 4, type: 'random_draw', value: 0.25 },
    ],
    outcome: { status: 'ok', value: 2 },
  };
}

describe('validateTape', () => {
  it('accepts a well-formed tape', () => {
    const tape = validTape();
    expect(validateTape(tape)).toBe(tape);
  });

  it.each([
    ['wrong format marker', (t: any) => (t.format = 'other'), /\$\.format/],
    ['future version', (t: any) => (t.version = 99), /unsupported version 99/],
    ['missing events', (t: any) => delete t.events, /\$\.events/],
    ['unknown event type', (t: any) => (t.events[0].type = 'telepathy'), /unknown event type "telepathy"/],
    ['out-of-order seq', (t: any) => (t.events[1].seq = 7), /events\[1\]\.seq: expected 1, got 7/],
    ['non-numeric clock value', (t: any) => (t.events[0].value = 'now'), /events\[0\]\.value: expected number/],
    ['llm_call without request', (t: any) => delete t.events[1].request, /events\[1\]\.request: missing/],
    ['malformed error', (t: any) => (t.events[3].error = { name: 1 }), /events\[3\]\.error\.name/],
    ['bad outcome status', (t: any) => (t.outcome.status = 'meh'), /\$\.outcome\.status/],
  ])('rejects %s', (_label, mutate, pattern) => {
    const tape = validTape();
    mutate(tape);
    expect(() => validateTape(tape)).toThrow(TapeFormatError);
    expect(() => validateTape(tape)).toThrow(pattern);
  });

  it('rejects non-objects', () => {
    expect(() => validateTape([])).toThrow(/expected a JSON object/);
  });
});
