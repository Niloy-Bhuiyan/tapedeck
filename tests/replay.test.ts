import { describe, expect, it } from 'vitest';
import { wrapOpenAI } from '../src/interceptors/providers.js';
import { tool } from '../src/interceptors/tool.js';
import { record } from '../src/record.js';
import { replay } from '../src/replay.js';
import { TapeDivergenceError } from '../src/runtime/replay-session.js';
import type { Tape } from '../src/tape/schema.js';

/** A tiny agent with an LLM, a tool, the clock and randomness, plus counters proving what really ran. */
function makeAgent(opts: { query?: string; extraCall?: boolean; skipTool?: boolean } = {}) {
  const real = { llm: 0, tool: 0 };
  const openai = wrapOpenAI({
    chat: {
      completions: {
        create: async (params: any) => {
          real.llm++;
          return { choices: [{ message: { content: `answer to ${params.messages[0].content} #${real.llm}` } }] };
        },
      },
    },
  });
  const search = tool('search', async ({ q }: { q: string }) => {
    real.tool++;
    return [`result for ${q}`, `live#${real.tool}`];
  });

  async function run() {
    const id = Math.random().toString(36).slice(2, 8);
    const startedAt = new Date().toISOString();
    const hits = opts.skipTool ? [] : await search({ q: opts.query ?? 'tapes' });
    const reply = await openai.chat.completions.create({ model: 'gpt-test', messages: [{ content: hits.join(' | ') }] });
    if (opts.extraCall) await openai.chat.completions.create({ model: 'gpt-test', messages: [{ content: 'again' }] });
    return { id, startedAt, answer: reply.choices[0]!.message.content, finishedAt: Date.now() };
  }
  return { run, real };
}

async function recordAgent(): Promise<Tape> {
  const { tape } = await record(makeAgent().run);
  return tape;
}

describe('replay()', () => {
  it('reproduces the recorded run exactly without doing real work', async () => {
    const recorded = await record(makeAgent().run);
    await new Promise((r) => setTimeout(r, 5)); // let the real clock move on

    const agent = makeAgent();
    const replayed = await replay(recorded.tape, agent.run);

    expect(replayed.ok).toBe(true);
    expect(replayed.divergences).toEqual([]);
    expect(replayed.result).toEqual(recorded.ok && recorded.result);
    expect(agent.real).toEqual({ llm: 0, tool: 0 });
  });

  it('produces an actual tape equivalent to the source tape', async () => {
    const tape = await recordAgent();
    const { actual } = await replay(tape, makeAgent().run);
    const strip = (t: Tape) => t.events.map(({ t: _t, ...rest }) => ({ ...rest, durationMs: 0 }));
    expect(strip(actual)).toEqual(strip(tape));
    expect(actual.outcome).toEqual(tape.outcome);
    expect(actual.metadata.replay).toEqual({ sourceTapeId: tape.id, mode: 'strict', divergences: [] });
  });

  it('is repeatable', async () => {
    const tape = await recordAgent();
    const first = await replay(tape, makeAgent().run);
    const second = await replay(tape, makeAgent().run);
    expect(second.result).toEqual(first.result);
  });

  it('returns copies so the code cannot mutate the tape', async () => {
    const tape = await recordAgent();
    await replay(tape, async () => {
      const agent = makeAgent();
      const result = await agent.run();
      (result as any).answer = 'mutated';
      return result;
    });
    const second = await replay(tape, makeAgent().run);
    expect((second.result as any).answer).not.toBe('mutated');
  });

  describe('strict mode', () => {
    it('throws TapeDivergenceError at the first changed tool argument', async () => {
      const tape = await recordAgent();
      const agent = makeAgent({ query: 'records' });
      const res = await replay(tape, agent.run);
      expect(res.ok).toBe(false);
      expect(res.error).toBeInstanceOf(TapeDivergenceError);
      expect((res.error as Error).message).toMatch(/tool_call "search" \(seq 2\) differs .*args\.q: "tapes" → "records"/);
      expect(agent.real).toEqual({ llm: 0, tool: 0 });
    });

    it('fails on an extra call the tape cannot answer', async () => {
      const tape = await recordAgent();
      const res = await replay(tape, makeAgent({ extraCall: true }).run);
      expect(res.error).toBeInstanceOf(TapeDivergenceError);
      expect(res.divergences[0]).toMatchObject({ kind: 'unexpected_call' });
    });

    it('reports recorded calls that were never made', async () => {
      const tape = await recordAgent();
      const res = await replay(tape, async () => 'did nothing');
      expect(res.ok).toBe(false);
      expect(res.error).toBeUndefined();
      expect(res.divergences).toEqual([
        expect.objectContaining({
          kind: 'unconsumed_events',
          message: '2 recorded call(s) were never made: tool_call "search", llm_call chat.completions.create',
        }),
      ]);
    });

    it('fails even if the code swallows the divergence error', async () => {
      const tape = await recordAgent();
      const agent = makeAgent({ query: 'other' });
      const res = await replay(tape, () => agent.run().catch(() => 'swallowed'));
      expect(res.result).toBe('swallowed');
      expect(res.ok).toBe(false);
    });
  });

  describe('diff mode', () => {
    it('records every divergence and keeps answering from the tape', async () => {
      const tape = await recordAgent();
      const agent = makeAgent({ query: 'records' });
      const res = await replay(tape, agent.run, { mode: 'diff' });
      expect(res.error).toBeUndefined();
      // The tool args changed, so the tool result is still the recorded one,
      // but the LLM request built from it is unchanged -> one divergence.
      expect(res.divergences.map((d) => d.kind)).toEqual(['mismatched_call']);
      expect(agent.real).toEqual({ llm: 0, tool: 0 });
    });

    it('exposes a structured diff of the replay run', async () => {
      const tape = await recordAgent();
      const res = await replay(tape, makeAgent({ query: 'records' }).run, { mode: 'diff' });
      expect(res.ok).toBe(false);
      expect(res.diff.firstDivergence).toMatchObject({
        status: 'changed',
        key: 'tool_call:search',
        changes: [{ path: 'args.q', a: 'tapes', b: 'records' }],
      });
      expect(res.diff.stats.changed).toBe(1);
    });

    it('detects code that skips a recorded step', async () => {
      const tape = await recordAgent();
      const res = await replay(tape, makeAgent({ skipTool: true }).run, { mode: 'diff' });
      // Skipping the tool changes the LLM prompt, and the tool call goes unconsumed.
      expect(res.divergences.map((d) => d.kind)).toEqual(['mismatched_call', 'unconsumed_events']);
      expect(res.diff.steps.filter((s) => s.status === 'removed').map((s) => s.key)).toEqual([
        'tool_call:search',
        'tool_result:search',
      ]);
    });

    it('stops at a call the tape cannot answer', async () => {
      const tape = await recordAgent();
      const res = await replay(tape, makeAgent({ extraCall: true }).run, { mode: 'diff' });
      expect(res.error).toBeInstanceOf(TapeDivergenceError);
    });

    it('performs unanswerable and changed calls for real with passthrough', async () => {
      const tape = await recordAgent();
      const agent = makeAgent({ query: 'records', extraCall: true });
      const res = await replay(tape, agent.run, { mode: 'diff', passthrough: true });
      expect(res.error).toBeUndefined();
      expect(agent.real).toEqual({ llm: 2, tool: 1 });
      expect(res.divergences.map((d) => d.kind)).toEqual(['mismatched_call', 'mismatched_call', 'unexpected_call']);
    });
  });

  it('re-throws recorded errors', async () => {
    const failing = wrapOpenAI({
      chat: {
        completions: {
          create: async (_params: unknown) => {
            throw Object.assign(new Error('overloaded'), { name: 'APIError', status: 529 });
          },
        },
      },
    });
    const run = () => failing.chat.completions.create({ messages: [] });
    const { tape } = await record(run);
    const res = await replay(tape, run);
    expect(res.ok).toBe(true);
    expect(res.error).toMatchObject({ name: 'APIError', message: 'overloaded', status: 529 });
    expect(res.actual.outcome).toEqual(tape.outcome);
  });

  it('replays streamed responses chunk by chunk', async () => {
    let realCalls = 0;
    const client = wrapOpenAI({
      chat: {
        completions: {
          create: async () => {
            realCalls++;
            return (async function* () {
              yield 'a';
              yield 'b';
            })();
          },
        },
      },
    }) as any;
    const run = async () => {
      const parts: string[] = [];
      for await (const chunk of await client.chat.completions.create({ stream: true })) parts.push(chunk);
      return parts.join('');
    };
    const { tape } = await record(run);
    const res = await replay(tape, run);
    expect(res.result).toBe('ab');
    expect(realCalls).toBe(1);
  });

  it('freezes the clock and seeds randomness once the tape runs out', async () => {
    const { tape } = await record(() => [Date.now(), Math.random()]);
    const run = () => [Date.now(), Math.random(), Date.now(), Math.random()];
    const a = await replay(tape, run, { mode: 'diff' });
    const b = await replay(tape, run, { mode: 'diff' });
    const [t1, r1, t2, r2] = a.result as number[];
    expect([t1, r1]).toEqual(tape.outcome?.value);
    expect(t2).toBe(t1);
    expect(r2).toBeGreaterThanOrEqual(0);
    expect(r2).toBeLessThan(1);
    expect(r2).not.toBe(r1);
    expect(b.result).toEqual(a.result);
  });

  it('accepts a path to a tape file', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { writeTapeFile } = await import('../src/tape/io.js');
    const tape = await recordAgent();
    const path = join(mkdtempSync(join(tmpdir(), 'tapedeck-replay-')), 'agent.tape.json');
    writeTapeFile(path, tape);
    const res = await replay(path, makeAgent().run);
    expect(res.ok).toBe(true);
  });
});
