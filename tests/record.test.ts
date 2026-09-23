import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tool } from '../src/interceptors/tool.js';
import { wrapOpenAI } from '../src/interceptors/providers.js';
import { record } from '../src/record.js';
import { VERSION } from '../src/version.js';

/** Minimal object with the OpenAI client's shape. */
function fakeOpenAI(reply: (params: any) => unknown = (p) => ({ echo: p.messages.at(-1).content })) {
  const calls: unknown[] = [];
  const client = {
    apiKey: 'sk-test',
    chat: {
      completions: {
        create: async (params: any) => {
          calls.push(params);
          Date.now(); // SDK-internal clock read: must not be recorded
          return reply(params);
        },
      },
    },
    models: { list: async () => ['m1'] },
  };
  return { client, calls };
}

describe('record()', () => {
  it('captures llm calls, tool calls, clock reads and random draws in order', async () => {
    const { client } = fakeOpenAI();
    const openai = wrapOpenAI(client);
    const add = tool('add', async ({ a, b }: { a: number; b: number }) => a + b);

    const { tape, ok } = await record(async () => {
      const started = Date.now();
      const reply = await openai.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
      const sum = await add({ a: 2, b: 3 });
      const roll = Math.random();
      return { reply, sum, roll, took: Date.now() - started };
    });

    expect(ok).toBe(true);
    expect(tape.events.map((e) => e.type)).toEqual([
      'clock_read',
      'llm_call',
      'tool_call',
      'tool_result',
      'random_draw',
      'clock_read',
    ]);
    expect(tape.events[1]).toMatchObject({
      provider: 'openai',
      operation: 'chat.completions.create',
      request: { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      response: { echo: 'hi' },
    });
    expect(tape.events[2]).toMatchObject({ tool: 'add', args: { a: 2, b: 3 } });
    expect(tape.events[3]).toMatchObject({ tool: 'add', result: 5, callId: tape.events[2]!.id });
    expect(tape.outcome).toMatchObject({ status: 'ok', value: { reply: { echo: 'hi' }, sum: 5 } });
  });

  it('passes real values through unchanged', async () => {
    const { client, calls } = fakeOpenAI(() => ({ answer: 42 }));
    const openai = wrapOpenAI(client);
    const { result } = (await record(() => openai.chat.completions.create({ messages: [{ content: 'q' }] }))) as {
      result: unknown;
    };
    expect(result).toEqual({ answer: 42 });
    expect(calls).toHaveLength(1);
  });

  it('only intercepts configured operations', async () => {
    const { client } = fakeOpenAI();
    const openai = wrapOpenAI(client);
    const { tape } = await record(async () => {
      await openai.models.list();
      return openai.apiKey;
    });
    expect(tape.events).toEqual([]);
    expect(tape.outcome?.value).toBe('sk-test');
  });

  it('keeps clock reads and random draws inside tools off the tape', async () => {
    const noisy = tool('noisy', async () => {
      Date.now();
      Math.random();
      return 'done';
    });
    const { tape } = await record(() => noisy(null));
    expect(tape.events.map((e) => e.type)).toEqual(['tool_call', 'tool_result']);
  });

  it('records errors from llm calls and tools and re-throws them', async () => {
    const { client } = fakeOpenAI(() => {
      throw Object.assign(new Error('rate limited'), { name: 'RateLimitError', status: 429 });
    });
    const openai = wrapOpenAI(client);
    const flaky = tool('flaky', async () => {
      throw new TypeError('bad input');
    });

    const { tape, ok } = await record(async () => {
      await openai.chat.completions.create({ messages: [{ content: 'x' }] }).catch(() => undefined);
      await flaky({});
    });

    expect(ok).toBe(false);
    expect(tape.events[0]).toMatchObject({ type: 'llm_call', error: { name: 'RateLimitError', status: 429 } });
    expect(tape.events[2]).toMatchObject({ type: 'tool_result', error: { name: 'TypeError', message: 'bad input' } });
    expect(tape.outcome).toEqual({ status: 'error', error: { name: 'TypeError', message: 'bad input' } });
  });

  it('records streamed responses as chunks and re-emits them', async () => {
    const client = {
      chat: {
        completions: {
          create: async () =>
            (async function* () {
              yield { delta: 'Hel' };
              yield { delta: 'lo' };
            })(),
        },
      },
    };
    const openai = wrapOpenAI(client) as any;
    const recorded = await record(async () => {
      const stream: AsyncIterable<{ delta: string }> = await openai.chat.completions.create({ stream: true });
      let text = '';
      for await (const chunk of stream) text += chunk.delta;
      return text;
    });
    expect(recorded.ok && recorded.result).toBe('Hello');
    expect(recorded.tape.events[0]).toMatchObject({ stream: true, response: [{ delta: 'Hel' }, { delta: 'lo' }] });
  });

  it('orders overlapping calls by start time', async () => {
    const slow = tool('slow', () => new Promise((r) => setTimeout(() => r('slow'), 20)));
    const fast = tool('fast', async () => 'fast');
    const { tape } = await record(() => Promise.all([slow(1), fast(2)]));
    expect(tape.events.map((e) => `${e.type}:${'tool' in e ? e.tool : ''}`)).toEqual([
      'tool_call:slow',
      'tool_call:fast',
      'tool_result:fast',
      'tool_result:slow',
    ]);
  });

  it('isolates concurrent recordings', async () => {
    const work = (label: string, delay: number) => async () => {
      await new Promise((r) => setTimeout(r, delay));
      Math.random();
      await tool(label, async () => label)(label);
      return label;
    };
    const [a, b] = await Promise.all([record(work('a', 10)), record(work('b', 1))]);
    expect(a.tape.events.filter((e) => e.type === 'tool_call').map((e) => (e as any).tool)).toEqual(['a']);
    expect(b.tape.events.filter((e) => e.type === 'tool_call').map((e) => (e as any).tool)).toEqual(['b']);
  });

  it('does not intercept calls made outside a recording', async () => {
    const { client, calls } = fakeOpenAI(() => 'direct');
    const openai = wrapOpenAI(client);
    await expect(openai.chat.completions.create({ messages: [{ content: 'x' }] })).resolves.toBe('direct');
    expect(calls).toHaveLength(1);
  });

  it('stamps name and metadata', async () => {
    const { tape } = await record(() => 1, { name: 'unit', metadata: { suite: 'record' } });
    expect(tape.name).toBe('unit');
    expect(tape.metadata).toMatchObject({ tapedeckVersion: VERSION, node: process.version, suite: 'record' });
  });

  it('keeps VERSION in sync with package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });
});
