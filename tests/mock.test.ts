import { describe, expect, it } from 'vitest';
import { wrapAnthropic, wrapOpenAI } from '../src/interceptors/providers.js';
import { MockAnthropic } from '../src/mock/anthropic.js';
import { MockOpenAI } from '../src/mock/openai.js';
import { record } from '../src/record.js';
import { replay } from '../src/replay.js';

describe('MockOpenAI', () => {
  it('echoes the last user message by default, in ChatCompletion shape', async () => {
    const client = new MockOpenAI();
    const res = await client.chat.completions.create({
      model: 'gpt-mock',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'ping' },
      ],
    });
    expect(res).toMatchObject({
      id: 'chatcmpl-mock-0',
      object: 'chat.completion',
      model: 'gpt-mock',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Mock response to: ping' }, finish_reason: 'stop' }],
    });
    expect(res.usage.total_tokens).toBe(res.usage.prompt_tokens + res.usage.completion_tokens);
  });

  it('produces tool calls with JSON-string arguments', async () => {
    const client = new MockOpenAI({ responder: () => ({ toolCalls: [{ name: 'search', input: { q: 'x' } }] }) });
    const res = await client.chat.completions.create({ model: 'm', messages: [] });
    expect(res.choices[0]).toMatchObject({
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: [{ id: 'call_mock_0_0', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }],
      },
    });
  });

  it('is deterministic across instances', async () => {
    const run = () => new MockOpenAI().chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'a' }] });
    expect(await run()).toEqual(await run());
  });

  it('passes the call index to the responder', async () => {
    const client = new MockOpenAI({ responder: (_p, i) => ({ text: `call ${i}` }) });
    await client.chat.completions.create({ model: 'm', messages: [] });
    const second = await client.chat.completions.create({ model: 'm', messages: [] });
    expect(second.choices[0]!.message.content).toBe('call 1');
  });

  it('rejects streaming requests', async () => {
    await expect(new MockOpenAI().chat.completions.create({ model: 'm', messages: [], stream: true })).rejects.toThrow(
      /does not support stream/,
    );
  });
});

describe('MockAnthropic', () => {
  it('returns Message-shaped text and tool_use blocks', async () => {
    const client = new MockAnthropic({
      responder: () => ({ text: 'Let me check.', toolCalls: [{ name: 'weather', input: { city: 'Oslo' } }] }),
    });
    const res = await client.messages.create({
      model: 'claude-mock',
      max_tokens: 100,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'weather?' }] }],
    });
    expect(res).toMatchObject({
      id: 'msg_mock_0',
      type: 'message',
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'toolu_mock_0_0', name: 'weather', input: { city: 'Oslo' } },
      ],
    });
  });

  it('echoes text content blocks by default', async () => {
    const res = await new MockAnthropic().messages.create({
      model: 'm',
      max_tokens: 10,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });
    expect(res.content).toEqual([{ type: 'text', text: 'Mock response to: hello' }]);
    expect(res.stop_reason).toBe('end_turn');
  });
});

describe('mocks under record/replay', () => {
  it('record and replay through wrapOpenAI and wrapAnthropic', async () => {
    const run = async () => {
      const openai = wrapOpenAI(new MockOpenAI());
      const anthropic = wrapAnthropic(new MockAnthropic());
      const a = await openai.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'one' }] });
      const b = await anthropic.messages.create({ model: 'm', max_tokens: 5, messages: [{ role: 'user', content: 'two' }] });
      return [a.choices[0]!.message.content, b.content[0]];
    };
    const recorded = await record(run);
    expect(recorded.tape.events.map((e) => (e.type === 'llm_call' ? e.provider : e.type))).toEqual(['openai', 'anthropic']);
    const replayed = await replay(recorded.tape, run);
    expect(replayed.ok).toBe(true);
    expect(replayed.result).toEqual(['Mock response to: one', { type: 'text', text: 'Mock response to: two' }]);
  });
});
