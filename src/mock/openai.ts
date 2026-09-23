// MOCK: a deterministic, offline stand-in for the `openai` client. It lets the
// test suite, the CLI and the example run with no OPENAI_API_KEY. Swap in
// `new OpenAI()` from the `openai` package once a real key is available; see
// MOCKED_COMPONENTS.md.
import { estimateTokens, type MockReply, type MockResponder } from './reply.js';

export interface MockChatParams {
  model: string;
  messages: Array<{ role: string; content?: unknown; [key: string]: unknown }>;
  stream?: boolean;
  [key: string]: unknown;
}

/** The subset of OpenAI's ChatCompletion shape the mock produces. */
export interface MockChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      refusal: null;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    };
    finish_reason: 'stop' | 'tool_calls';
    logprobs: null;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/** Fixed timestamp so mock responses are byte-for-byte reproducible. */
const MOCK_CREATED = 1_767_225_600; // 2026-01-01T00:00:00Z

function lastUserText(messages: MockChatParams['messages']): string {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  return typeof last?.content === 'string' ? last.content : '';
}

/** Default behaviour: acknowledge the last user message. */
export const echoResponder: MockResponder<MockChatParams> = (params) => ({
  text: `Mock response to: ${lastUserText(params.messages)}`,
});

/**
 * Mimics `client.chat.completions.create` from the official SDK, returning
 * canned replies chosen by a responder function.
 *
 * @example
 * const client = new MockOpenAI({ responder: () => ({ text: 'Hello!' }) });
 */
export class MockOpenAI {
  private calls = 0;
  readonly chat: { completions: { create: (params: MockChatParams) => Promise<MockChatCompletion> } };

  constructor(options: { responder?: MockResponder<MockChatParams> } = {}) {
    const responder = options.responder ?? echoResponder;
    this.chat = {
      completions: {
        create: async (params) => {
          if (params.stream) throw new Error('MockOpenAI does not support stream: true');
          const index = this.calls++;
          return this.toCompletion(params, index, await responder(params, index));
        },
      },
    };
  }

  private toCompletion(params: MockChatParams, index: number, reply: MockReply): MockChatCompletion {
    const toolCalls = (reply.toolCalls ?? []).map((call, i) => ({
      id: `call_mock_${index}_${i}`,
      type: 'function' as const,
      function: { name: call.name, arguments: JSON.stringify(call.input) },
    }));
    const message: MockChatCompletion['choices'][number]['message'] = {
      role: 'assistant',
      content: reply.text ?? null,
      refusal: null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
    const promptTokens = estimateTokens(params.messages);
    const completionTokens = estimateTokens(message);
    return {
      id: `chatcmpl-mock-${index}`,
      object: 'chat.completion',
      created: MOCK_CREATED,
      model: params.model,
      choices: [{ index: 0, message, finish_reason: toolCalls.length ? 'tool_calls' : 'stop', logprobs: null }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
    };
  }
}
