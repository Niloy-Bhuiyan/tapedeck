// MOCK: a deterministic, offline stand-in for the `@anthropic-ai/sdk` client.
// It lets tests and examples run with no ANTHROPIC_API_KEY. Swap in
// `new Anthropic()` once a real key is available; see MOCKED_COMPONENTS.md.
import { estimateTokens, type MockReply, type MockResponder } from './reply.js';

export interface MockMessageParams {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: unknown }>;
  system?: unknown;
  stream?: boolean;
  [key: string]: unknown;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

/** The subset of Anthropic's Message shape the mock produces. */
export interface MockMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use';
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
}

function lastUserText(messages: MockMessageParams['messages']): string {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  if (typeof last?.content === 'string') return last.content;
  if (Array.isArray(last?.content)) {
    return last.content
      .filter((b): b is { type: 'text'; text: string } => (b as { type?: string })?.type === 'text')
      .map((b) => b.text)
      .join(' ');
  }
  return '';
}

/** Default behaviour: acknowledge the last user message. */
export const echoMessageResponder: MockResponder<MockMessageParams> = (params) => ({
  text: `Mock response to: ${lastUserText(params.messages)}`,
});

/**
 * Mimics `client.messages.create` from the official SDK, returning canned
 * replies chosen by a responder function.
 */
export class MockAnthropic {
  private calls = 0;
  readonly messages: { create: (params: MockMessageParams) => Promise<MockMessage> };

  constructor(options: { responder?: MockResponder<MockMessageParams> } = {}) {
    const responder = options.responder ?? echoMessageResponder;
    this.messages = {
      create: async (params) => {
        if (params.stream) throw new Error('MockAnthropic does not support stream: true');
        const index = this.calls++;
        return this.toMessage(params, index, await responder(params, index));
      },
    };
  }

  private toMessage(params: MockMessageParams, index: number, reply: MockReply): MockMessage {
    const content: ContentBlock[] = [];
    if (reply.text) content.push({ type: 'text', text: reply.text });
    (reply.toolCalls ?? []).forEach((call, i) =>
      content.push({ type: 'tool_use', id: `toolu_mock_${index}_${i}`, name: call.name, input: call.input }),
    );
    return {
      id: `msg_mock_${index}`,
      type: 'message',
      role: 'assistant',
      model: params.model,
      content,
      stop_reason: reply.toolCalls?.length ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: estimateTokens(params.messages), output_tokens: estimateTokens(content) },
    };
  }
}
