// MOCK: a tiny OpenAI-compatible server (POST /v1/chat/completions, streaming
// or not) so the zero-code demo runs offline. With a real OPENAI_API_KEY you
// can skip it and record agent.mjs against api.openai.com directly.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

function planFor(prompt: string): string {
  const city = prompt.match(/trip to (.+?)\./)?.[1] ?? 'somewhere';
  return `- Morning: coffee and a walk through the old town of ${city}.\n- Afternoon: the best museum in ${city}.\n- Evening: dinner with a view.`;
}

export async function startFakeOpenAI(): Promise<{ baseURL: string; host: string; requests: () => number; close: () => Promise<void> }> {
  let count = 0;
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      count++;
      const params = JSON.parse(body || '{}');
      const text = planFor(String(params.messages?.at(-1)?.content ?? ''));
      const base = { id: `chatcmpl-demo-${count}`, created: 1767225600, model: params.model };
      if (!params.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const piece of text.match(/.{1,24}/gs) ?? []) {
        const chunk = { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseURL: `http://${host}/v1`,
    host,
    requests: () => count,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
