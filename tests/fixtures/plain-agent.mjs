// An ordinary agent script with no TapeDeck code at all. The zero-code
// tests record and replay it purely through the CLI's preload.
import OpenAI from 'openai';

const [baseURL, question = 'What should I pack?'] = process.argv.slice(2);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? 'sk-local-test', baseURL, maxRetries: 0 });

const today = new Date().toISOString().slice(0, 10);
const traceId = Math.random().toString(36).slice(2, 10);
const res = await client.chat.completions.create({
  model: 'gpt-4.1-mini',
  messages: [
    { role: 'system', content: `Today is ${today}. Trace ${traceId}.` },
    { role: 'user', content: question },
  ],
});
console.log(JSON.stringify({ answer: res.choices[0].message.content, today, traceId }));
