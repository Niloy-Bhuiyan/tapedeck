import { describe, expect, it } from 'vitest';
import { TapeRecorder } from '../../src/tape/recorder.js';

function fakeClock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('TapeRecorder', () => {
  it('assigns seq and relative timestamps in append order', () => {
    const clock = fakeClock();
    const rec = new TapeRecorder(clock.now);
    rec.append({ type: 'random_draw', value: 0.5 });
    clock.advance(25);
    rec.append({ type: 'clock_read', source: 'Date.now', value: 123 });
    expect(rec.events.map((e) => [e.seq, e.t])).toEqual([
      [0, 0],
      [1, 25],
    ]);
  });

  it('derives stable IDs from inputs and occurrence count', () => {
    const run = () => {
      const rec = new TapeRecorder(fakeClock().now);
      rec.append({ type: 'tool_call', tool: 'search', callId: 'x', args: { q: 'a' } });
      rec.append({ type: 'random_draw', value: 0.1 });
      rec.append({ type: 'tool_call', tool: 'search', callId: 'y', args: { q: 'a' } });
      return rec.events.map((e) => e.id);
    };
    const ids = run();
    expect(ids).toEqual(run());
    expect(ids[0]).toMatch(/^tool_call:[0-9a-f]{8}:0$/);
    expect(ids[2]).toBe(ids[0]!.replace(/:0$/, ':1'));
  });

  it('does not shift IDs of unrelated events when another event is inserted', () => {
    const a = new TapeRecorder(fakeClock().now);
    a.append({ type: 'tool_call', tool: 'calc', callId: '', args: '1+1' });
    const b = new TapeRecorder(fakeClock().now);
    b.append({ type: 'random_draw', value: 0.3 });
    b.append({ type: 'tool_call', tool: 'calc', callId: '', args: '1+1' });
    expect(b.events[1]!.id).toBe(a.events[0]!.id);
  });

  it('ignores response data when deriving llm_call IDs', () => {
    const base = { type: 'llm_call', provider: 'mock', operation: 'op', request: { p: 1 }, durationMs: 0 } as const;
    const a = new TapeRecorder(fakeClock().now).append({ ...base, response: 'one' });
    const b = new TapeRecorder(fakeClock().now).append({ ...base, response: 'two' });
    expect(a.id).toBe(b.id);
  });

  it('returns the stored event so late fields can be filled in', () => {
    const rec = new TapeRecorder(fakeClock().now);
    const ev = rec.append({ type: 'llm_call', provider: 'mock', operation: 'op', request: {}, durationMs: 0 });
    ev.response = { ok: true };
    expect(rec.events[0]).toMatchObject({ response: { ok: true } });
  });

  it('builds a well-formed tape', () => {
    const rec = new TapeRecorder(fakeClock(Date.UTC(2026, 0, 1)).now);
    const tape = rec.toTape({ name: 'demo', outcome: { status: 'ok', value: 1 } });
    expect(tape).toMatchObject({
      format: 'tapedeck.tape',
      version: 1,
      name: 'demo',
      createdAt: '2026-01-01T00:00:00.000Z',
      outcome: { status: 'ok', value: 1 },
      events: [],
    });
    expect(tape.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
