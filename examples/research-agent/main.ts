// Entry point: node --import tsx examples/research-agent/main.ts [--variant=v2] ["question"]
import { createResearchAgent, DEFAULT_QUESTION } from './agent.js';
import { createClient } from './client.js';

const args = process.argv.slice(2);
const variant = args.includes('--variant=v2') ? 'v2' : 'v1';
const question = args.find((a) => !a.startsWith('--')) ?? DEFAULT_QUESTION;

const agent = createResearchAgent({ client: createClient(), variant, model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini' });
const result = await agent(question);
console.log(JSON.stringify(result, null, 2));
