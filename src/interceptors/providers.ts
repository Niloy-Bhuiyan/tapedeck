import { wrapClient } from './client.js';

/** OpenAI SDK methods that are recorded and replayed. */
export const OPENAI_OPERATIONS = ['chat.completions.create', 'responses.create', 'embeddings.create'] as const;

/** Anthropic SDK methods that are recorded and replayed. */
export const ANTHROPIC_OPERATIONS = ['messages.create'] as const;

/**
 * Instruments an `openai` client (or anything with the same shape, such as
 * `MockOpenAI`). Use the returned client in place of the original.
 *
 * @example
 * import OpenAI from 'openai';
 * const openai = wrapOpenAI(new OpenAI());
 */
export function wrapOpenAI<T extends object>(client: T): T {
  return wrapClient(client, 'openai', OPENAI_OPERATIONS);
}

/**
 * Instruments an `@anthropic-ai/sdk` client (or `MockAnthropic`).
 *
 * @example
 * import Anthropic from '@anthropic-ai/sdk';
 * const anthropic = wrapAnthropic(new Anthropic());
 */
export function wrapAnthropic<T extends object>(client: T): T {
  return wrapClient(client, 'anthropic', ANTHROPIC_OPERATIONS);
}
