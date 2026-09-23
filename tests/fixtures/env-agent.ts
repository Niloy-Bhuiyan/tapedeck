// A tiny "agent" run as a separate process by the env/CLI tests.
import { tool, wrapOpenAI } from '../../src/index.js';

const openai = wrapOpenAI({
  chat: {
    completions: {
      create: async (params: { q: string }) => ({ echo: params.q, servedAt: Date.now() }),
    },
  },
});
const double = tool('double', async (n: number) => n * 2);

const startedAt = Date.now();
const reply = await openai.chat.completions.create({ q: process.argv[2] ?? 'hi' });
const doubled = await double(21);
console.log(JSON.stringify({ reply, doubled, roll: Math.random(), startedAt }));
if (process.argv[3] === 'fail') process.exitCode = 3;
