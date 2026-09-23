// Builds the chat client: the real OpenAI API when OPENAI_API_KEY is set, the
// deterministic MockOpenAI "brain" otherwise, so the example runs offline.
import OpenAI from 'openai';
import { MockOpenAI, wrapOpenAI } from '../../src/index.js';
import type { ChatClient } from './agent.js';
import { researchBrain } from './mock-brain.js';

export function createClient(): ChatClient {
  const client = process.env.OPENAI_API_KEY
    ? new OpenAI() // reads OPENAI_API_KEY from the environment
    : new MockOpenAI({ responder: researchBrain }); // MOCK: offline fallback
  return wrapOpenAI(client) as unknown as ChatClient;
}
