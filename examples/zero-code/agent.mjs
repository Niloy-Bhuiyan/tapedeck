// A completely ordinary OpenAI script. There is no TapeDeck code in here:
// `tapedeck record -- node agent.mjs` captures it from the outside.
import OpenAI from 'openai';

const openai = new OpenAI(); // reads OPENAI_API_KEY (and OPENAI_BASE_URL, if set)
const city = process.argv[2] ?? 'Lisbon';
const today = new Date().toDateString();

const stream = await openai.chat.completions.create({
  model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
  stream: true,
  messages: [
    { role: 'system', content: `You plan day trips in three short bullet points. Today is ${today}.` },
    { role: 'user', content: `Plan a one-day trip to ${city}.` },
  ],
});

for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
process.stdout.write('\n');
