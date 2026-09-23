import { describe, expect, it } from 'vitest';
import { diffTapes } from '../../src/diff/diff.js';
import { TapeRecorder } from '../../src/tape/recorder.js';
import type { Tape, TapeOutcome } from '../../src/tape/schema.js';

type Step =
  | ['llm', string, string]
  | ['call', string, unknown]
  | ['result', string, unknown]
  | ['clock', number]
  | ['random', number];

/** Builds a tape from a compact step list. */
function tape(steps: Step[], outcome: TapeOutcome = { status: 'ok', value: 'done' }): Tape {
  let now = 0;
  const rec = new TapeRecorder(() => (now += 7));
  const calls = new Map<string, string>();
  for (const step of steps) {
    switch (step[0]) {
      case 'llm':
        rec.append({
          type: 'llm_call',
          provider: 'openai',
          operation: 'chat.completions.create',
          request: { prompt: step[1] },
          response: { text: step[2] },
          durationMs: now,
        });
        break;
      case 'call': {
        const ev = rec.append({ type: 'tool_call', tool: step[1], callId: '', args: step[2] as never });
        ev.callId = ev.id;
        calls.set(step[1], ev.id);
        break;
      }
      case 'result':
        rec.append({ type: 'tool_result', tool: step[1], callId: calls.get(step[1])!, result: step[2] as never, durationMs: 1 });
        break;
      case 'clock':
        rec.append({ type: 'clock_read', source: 'Date.now', value: step[1] });
        break;
      case 'random':
        rec.append({ type: 'random_draw', value: step[1] });
        break;
    }
  }
  return rec.toTape({ outcome });
}

const baseline: Step[] = [
  ['clock', 1000],
  ['llm', 'plan', 'search for tapes'],
  ['call', 'search', { q: 'tapes' }],
  ['result', 'search', ['a', 'b']],
  ['llm', 'answer with a, b', 'final'],
];

describe('diffTapes', () => {
  it('reports identical runs as equal, ignoring ids, timings and tape identity', () => {
    const diff = diffTapes(tape(baseline), tape(baseline));
    expect(diff.equal).toBe(true);
    expect(diff.stats).toEqual({ matched: 5, changed: 0, added: 0, removed: 0 });
    expect(diff.firstDivergence).toBeNull();
    expect(diff.summary).toBe('Tapes match: all 5 steps are identical.');
  });

  it('pinpoints changed tool arguments', () => {
    const changed = structuredClone(baseline);
    changed[2] = ['call', 'search', { q: 'cassettes' }];
    const diff = diffTapes(tape(baseline), tape(changed));
    expect(diff.equal).toBe(false);
    expect(diff.firstDivergence).toMatchObject({
      index: 2,
      status: 'changed',
      key: 'tool_call:search',
      changes: [{ path: 'args.q', kind: 'changed', a: 'tapes', b: 'cassettes' }],
    });
    expect(diff.summary).toContain('Tapes diverge at step 3 of 5.');
    expect(diff.summary).toContain('Step 3: tool call "search" was called with different arguments:\n  - args.q: "tapes" → "cassettes"');
  });

  it('distinguishes changed LLM requests from changed responses', () => {
    const req = structuredClone(baseline);
    req[1] = ['llm', 'plan carefully', 'search for tapes'];
    expect(diffTapes(tape(baseline), tape(req)).summary).toContain('LLM call (openai chat.completions.create) was sent a different request');

    const res = structuredClone(baseline);
    res[4] = ['llm', 'answer with a, b', 'different final'];
    expect(diffTapes(tape(baseline), tape(res)).summary).toContain('returned a different response');
  });

  it('aligns around inserted and removed steps', () => {
    const extra: Step[] = [
      ...baseline.slice(0, 4),
      ['call', 'calculator', '2+2'],
      ['result', 'calculator', 4],
      baseline[4]!,
    ];
    const diff = diffTapes(tape(baseline), tape(extra));
    expect(diff.steps.map((s) => s.status)).toEqual(['match', 'match', 'match', 'match', 'added', 'added', 'match']);
    expect(diff.summary).toContain('Step 5: the new run made an extra tool call "calculator" that is not in the baseline');

    const reverse = diffTapes(tape(extra), tape(baseline));
    expect(reverse.steps.filter((s) => s.status === 'removed').map((s) => s.key)).toEqual([
      'tool_call:calculator',
      'tool_result:calculator',
    ]);
    expect(reverse.summary).toContain("the baseline's tool call \"calculator\" is missing from the new run");
  });

  it('treats a renamed tool as a removal plus an addition', () => {
    const renamed = structuredClone(baseline);
    renamed[2] = ['call', 'lookup', { q: 'tapes' }];
    renamed[3] = ['result', 'lookup', ['a', 'b']];
    const statuses = diffTapes(tape(baseline), tape(renamed)).steps.map((s) => `${s.status}:${s.key}`);
    expect(statuses).toContain('removed:tool_call:search');
    expect(statuses).toContain('added:tool_call:lookup');
  });

  it('compares outcomes', () => {
    const diff = diffTapes(tape(baseline), tape(baseline, { status: 'error', error: { name: 'Error', message: 'x' } }));
    expect(diff.equal).toBe(false);
    expect(diff.firstDivergence).toBeNull();
    expect(diff.outcome.status).toBe('changed');
    expect(diff.summary).toMatch(/^All 5 steps match, but the runs ended differently\./);
    expect(diff.summary).toContain('status: "ok" → "error"');
    expect(diffTapes(tape(baseline), tape(baseline, { status: 'ok', value: 'other' }), { ignoreOutcome: true }).equal).toBe(true);
  });

  it('can ignore event types', () => {
    const noisy: Step[] = [['clock', 5], ['random', 0.3], ...baseline.slice(1)];
    expect(diffTapes(tape(baseline), tape(noisy)).equal).toBe(false);
    expect(diffTapes(tape(baseline), tape(noisy), { ignoreTypes: ['clock_read', 'random_draw'] }).equal).toBe(true);
  });

  it('handles empty tapes and completely different tapes', () => {
    expect(diffTapes(tape([]), tape([])).equal).toBe(true);
    const diff = diffTapes(tape([['random', 0.1]]), tape([['clock', 1]]));
    expect(diff.steps.map((s) => s.status)).toEqual(['removed', 'added']);
  });

  it('keeps step indexes sequential', () => {
    const diff = diffTapes(tape(baseline), tape([...baseline, ['random', 0.5]]));
    expect(diff.steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('scales to long, mostly identical tapes', () => {
    const long: Step[] = Array.from({ length: 3000 }, (_, i) => ['random', i / 3000] as Step);
    const edited = [...long];
    edited.splice(1500, 1, ['clock', 1]);
    const started = performance.now();
    const diff = diffTapes(tape(long), tape(edited));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(diff.stats).toMatchObject({ added: 1, removed: 1 });
  });
});
