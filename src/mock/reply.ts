// MOCK: shared types for the deterministic fake LLM providers. See MOCKED_COMPONENTS.md.

/** A tool call a mock model should make. */
export interface MockToolCall {
  name: string;
  /** Tool input; serialized to a JSON string for OpenAI, passed as an object for Anthropic. */
  input: unknown;
}

/** What a mock model should answer: text, tool calls, or both. */
export interface MockReply {
  text?: string | null;
  toolCalls?: MockToolCall[];
}

/** Picks a reply for a request. `callIndex` counts calls made on this client, from 0. */
export type MockResponder<Params> = (params: Params, callIndex: number) => MockReply | Promise<MockReply>;

/** Rough token estimate (4 characters per token) so usage numbers look plausible. */
export function estimateTokens(value: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(value ?? '').length / 4));
}
