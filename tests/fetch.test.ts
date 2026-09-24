/**
 * Network-level capture, end to end: the official SDKs are used *without*
 * any TapeDeck wrapper and talk over real HTTP to a local server posing as
 * the provider. TapeDeck must record those calls and replay them without
 * the server being contacted.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  configureFetchInterception,
  installFetchInterceptor,
  parseSse,
  safePath,
  serializeSse,
} from '../src/interceptors/fetch.js';
import { wrapOpenAI } from '../src/interceptors/providers.js';
import { record } from '../src/record.js';
import { replay } from '../src/replay.js';
import type { LlmCallEvent } from '../src/tape/schema.js';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;

let server: Server;
let host: string;
let hits = 0;
let handler: Handler;

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'x-secret-header': 'do-not-record' });
  res.end(JSON.stringify(body));
};

const completion = (content: string) => ({
  id: 'chatcmpl-local',
  object: 'chat.completion',
  created: 1,
  model: 'local-model',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop', logprobs: null }],
});

beforeAll(async () => {
  installFetchInterceptor();
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      hits++;
      handler(req, body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  configureFetchInterception({ llmHosts: [host] });
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  hits = 0;
  handler = (_req, body, res) => {
    const params = JSON.parse(body || '{}');
    json(res, 200, completion(`echo: ${params.messages?.at(-1)?.content}`));
  };
});

const openai = () => new OpenAI({ apiKey: 'sk-live-secret', baseURL: `http://${host}/v1`, maxRetries: 0 });

async function ask(client: OpenAI, content: string) {
  const res = await client.chat.completions.create({ model: 'local-model', messages: [{ role: 'user', content }] });
  return res.choices[0]?.message.content;
}

describe('fetch interception with unwrapped SDKs', () => {
  it('records an unwrapped OpenAI client and replays it without the network', async () => {
    const recorded = await record(() => ask(openai(), 'hello'));
    expect(recorded.ok && recorded.result).toBe('echo: hello');
    expect(hits).toBe(1);

    const event = recorded.tape.events[0] as LlmCallEvent;
    expect(event).toMatchObject({
      type: 'llm_call',
      provider: host,
      operation: 'POST /v1/chat/completions',
      request: { model: 'local-model', messages: [{ role: 'user', content: 'hello' }] },
      response: { id: 'chatcmpl-local' },
      http: { status: 200, headers: { 'content-type': 'application/json' } },
    });

    const replayed = await replay(recorded.tape, () => ask(openai(), 'hello'));
    expect(replayed.ok).toBe(true);
    expect(replayed.result).toBe('echo: hello');
    expect(hits).toBe(1);
  });

  it('never records API keys or unlisted headers', async () => {
    const { tape } = await record(() => ask(openai(), 'secret?'));
    const text = JSON.stringify(tape);
    expect(text).not.toContain('sk-live-secret');
    expect(text).not.toContain('do-not-record');
  });

  it('detects a changed prompt', async () => {
    const { tape } = await record(() => ask(openai(), 'hello'));
    const replayed = await replay(tape, () => ask(openai(), 'goodbye'), { mode: 'diff' });
    expect(replayed.ok).toBe(false);
    expect(replayed.diff.firstDivergence?.changes).toEqual([
      { path: 'request.messages[0].content', kind: 'changed', a: 'hello', b: 'goodbye' },
    ]);
    expect(hits).toBe(1);
  });

  it('replays OpenAI streams through the SDK’s own stream parser', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const piece of ['Hel', 'lo', '!']) {
        res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`);
      }
      res.end('data: [DONE]\n\n');
    };
    const run = async () => {
      const stream = await openai().chat.completions.create({
        model: 'm',
        messages: [{ role: 'user', content: 'stream please' }],
        stream: true,
      });
      let text = '';
      for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? '';
      return text;
    };
    const recorded = await record(run);
    expect(recorded.ok && recorded.result).toBe('Hello!');
    const event = recorded.tape.events[0] as LlmCallEvent;
    expect(event.stream).toBe(true);
    expect((event.response as unknown[]).at(-1)).toEqual({ data: '[DONE]' });

    const replayed = await replay(recorded.tape, run);
    expect(replayed.result).toBe('Hello!');
    expect(hits).toBe(1);
  });

  it('replays Anthropic event streams', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('message_start', {
        type: 'message_start',
        message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } },
      });
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi Claude' } });
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
      send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } });
      send('message_stop', { type: 'message_stop' });
      res.end();
    };
    const run = async () => {
      const client = new Anthropic({ apiKey: 'k', baseURL: `http://${host}`, maxRetries: 0 });
      const stream = client.messages.stream({ model: 'claude-x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
      const message = await stream.finalMessage();
      return message.content[0]?.type === 'text' ? message.content[0].text : null;
    };
    const recorded = await record(run);
    expect(recorded.ok && recorded.result).toBe('Hi Claude');
    const replayed = await replay(recorded.tape, run);
    expect(replayed.ok).toBe(true);
    expect(replayed.result).toBe('Hi Claude');
    expect(hits).toBe(1);
  });

  it('replays recorded rate-limit retries without waiting', async () => {
    let calls = 0;
    handler = (_req, _body, res) => {
      calls++;
      if (calls === 1) json(res, 429, { error: { message: 'slow down', type: 'rate_limit', code: 'rate_limit_exceeded' } });
      else json(res, 200, completion('finally'));
    };
    const client = () => new OpenAI({ apiKey: 'k', baseURL: `http://${host}/v1`, maxRetries: 1 });
    const recorded = await record(() => ask(client(), 'retry'));
    expect(recorded.ok && recorded.result).toBe('finally');
    expect(recorded.tape.events.map((e) => (e as LlmCallEvent).http?.status)).toEqual([429, 200]);

    const started = performance.now();
    const replayed = await replay(recorded.tape, () => ask(client(), 'retry'));
    expect(replayed.ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(400);
    expect(hits).toBe(2);
  });

  it('does not double-record calls made through wrapOpenAI', async () => {
    const { tape } = await record(() => ask(wrapOpenAI(openai()), 'once'));
    expect(tape.events).toHaveLength(1);
    expect(tape.events[0]).toMatchObject({ operation: 'chat.completions.create' });
  });

  it('leaves other hosts alone', async () => {
    const other = createServer((_req, res) => res.end('plain'));
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(other.address() as AddressInfo).port}/`;
    const { tape, ok } = await record(async () => (await fetch(url)).text());
    other.close();
    expect(ok).toBe(true);
    expect(tape.events).toEqual([]);
  });

  it('records configured non-LLM hosts as http tools', async () => {
    const api = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"results":["tape"]}');
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    const apiHost = `127.0.0.1:${(api.address() as AddressInfo).port}`;
    configureFetchInterception({ httpHosts: [apiHost] });
    const run = async () => (await fetch(`http://${apiHost}/search?q=tapes&api_key=hunter2`)).json();

    const recorded = await record(run);
    api.close();
    expect(recorded.tape.events[0]).toMatchObject({
      type: 'tool_call',
      tool: `http ${apiHost}`,
      args: { method: 'GET', url: `http://${apiHost}/search?q=tapes&api_key=%5Bredacted%5D`, body: null },
    });
    expect(recorded.tape.events[1]).toMatchObject({ type: 'tool_result', result: { status: 200, body: { results: ['tape'] } } });

    const replayed = await replay(recorded.tape, run); // the server is closed now
    expect(replayed.ok).toBe(true);
    expect(replayed.result).toEqual({ results: ['tape'] });
  });
});

describe('fetch helpers', () => {
  it('redacts secret-looking query parameters', () => {
    expect(safePath(new URL('https://x.test/v1/models/g:generateContent?key=abc&alt=sse'))).toBe(
      '/v1/models/g:generateContent?key=%5Bredacted%5D&alt=sse',
    );
    expect(safePath(new URL('https://x.test/plain'))).toBe('/plain');
  });

  it('round-trips server-sent events', () => {
    const text = 'event: ping\ndata: {"a":1}\n\ndata: [DONE]\n\n';
    const frames = parseSse(text);
    expect(frames).toEqual([{ event: 'ping', data: { a: 1 } }, { data: '[DONE]' }]);
    expect(serializeSse(frames)).toBe(text);
  });

  it('joins multi-line data and ignores comments', () => {
    expect(parseSse(': keep-alive\n\ndata: line one\ndata: line two\n\n')).toEqual([{ data: 'line one\nline two' }]);
  });
});
