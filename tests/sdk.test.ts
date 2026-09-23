/**
 * Integration tests against the official SDKs. A stub `fetch` stands in for
 * the network, so these run offline while exercising the real client code
 * paths that `wrapOpenAI` / `wrapAnthropic` intercept.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { wrapAnthropic, wrapOpenAI } from '../src/interceptors/providers.js';
import { record } from '../src/record.js';
import { replay } from '../src/replay.js';

function stubFetch(body: unknown, status = 200) {
  const requests: Array<{ url: string; body: unknown }> = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const chatCompletion = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1,
  model: 'gpt-4o-mini',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hi from OpenAI' }, finish_reason: 'stop', logprobs: null }],
  usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
};

const anthropicMessage = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5',
  content: [{ type: 'text', text: 'Hi from Claude' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 3, output_tokens: 4 },
};

describe('official openai SDK', () => {
  it('records real calls and replays them without touching the network', async () => {
    const live = stubFetch(chatCompletion);
    const run = (client: OpenAI) => async () => {
      const res = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say hi' }],
      });
      return res.choices[0]?.message.content;
    };

    const recorded = await record(run(wrapOpenAI(new OpenAI({ apiKey: 'sk-test', fetch: live.fetch, maxRetries: 0 }))));
    expect(recorded.ok && recorded.result).toBe('Hi from OpenAI');
    expect(live.requests).toHaveLength(1);
    expect(live.requests[0]!.url).toContain('/chat/completions');
    expect(recorded.tape.events).toHaveLength(1);
    expect(recorded.tape.events[0]).toMatchObject({
      provider: 'openai',
      operation: 'chat.completions.create',
      request: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Say hi' }] },
      response: { id: 'chatcmpl-1' },
    });

    const offline = stubFetch({ error: 'network must not be used' }, 500);
    const client = wrapOpenAI(new OpenAI({ apiKey: 'unused-during-replay', fetch: offline.fetch, maxRetries: 0 }));
    const replayed = await replay(recorded.tape, run(client));
    expect(replayed.ok).toBe(true);
    expect(replayed.result).toBe('Hi from OpenAI');
    expect(offline.requests).toHaveLength(0);
  });

  it('records and replays API errors', async () => {
    const failing = stubFetch({ error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' } }, 429);
    const run = (client: OpenAI) => () => client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'x' }] });

    const recorded = await record(run(wrapOpenAI(new OpenAI({ apiKey: 'k', fetch: failing.fetch, maxRetries: 0 }))));
    expect(recorded.ok).toBe(false);
    expect(recorded.tape.events[0]).toMatchObject({ error: { status: 429, code: 'rate_limit_exceeded' } });

    const replayed = await replay(recorded.tape, run(wrapOpenAI(new OpenAI({ apiKey: 'k', fetch: stubFetch({}).fetch }))));
    expect(replayed.ok).toBe(true);
    expect(replayed.error).toMatchObject({ status: 429, code: 'rate_limit_exceeded' });
  });

  it('leaves non-intercepted SDK surface working', async () => {
    const client = wrapOpenAI(new OpenAI({ apiKey: 'sk-visible', fetch: stubFetch({}).fetch }));
    expect(client.apiKey).toBe('sk-visible');
    expect(client.baseURL).toContain('api.openai.com');
  });
});

describe('official @anthropic-ai/sdk', () => {
  it('records real calls and replays them without touching the network', async () => {
    const live = stubFetch(anthropicMessage);
    const run = (client: Anthropic) => async () => {
      const res = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Say hi' }],
      });
      const block = res.content[0];
      return block?.type === 'text' ? block.text : null;
    };

    const recorded = await record(run(wrapAnthropic(new Anthropic({ apiKey: 'k', fetch: live.fetch, maxRetries: 0 }))));
    expect(recorded.ok && recorded.result).toBe('Hi from Claude');
    expect(live.requests[0]!.url).toContain('/v1/messages');
    expect(recorded.tape.events[0]).toMatchObject({ provider: 'anthropic', operation: 'messages.create' });

    const offline = stubFetch({}, 500);
    const replayed = await replay(recorded.tape, run(wrapAnthropic(new Anthropic({ apiKey: 'k', fetch: offline.fetch }))));
    expect(replayed.ok).toBe(true);
    expect(replayed.result).toBe('Hi from Claude');
    expect(offline.requests).toHaveLength(0);
  });
});
