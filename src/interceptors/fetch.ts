/**
 * Network-level capture: records calls made through `globalThis.fetch` to
 * known LLM APIs, so any SDK or framework built on fetch (OpenAI, Anthropic,
 * Vercel AI SDK, LangChain.js, …) is recorded and replayed without code
 * changes.
 *
 * Only request *bodies* are recorded. Request headers — where API keys live —
 * are never stored, secret-looking query parameters are redacted, and only a
 * small allowlist of response headers is kept.
 */
import type { LlmCodec, ToolCodec } from '../runtime/codec.js';
import { currentSession, runtime } from '../runtime/context.js';
import type { HttpMeta, Json } from '../tape/schema.js';

/** Hosts recognised as LLM APIs out of the box, mapped to a provider name. */
export const LLM_HOSTS: Readonly<Record<string, string>> = {
  'api.openai.com': 'openai',
  'api.anthropic.com': 'anthropic',
  'generativelanguage.googleapis.com': 'google',
  'api.mistral.ai': 'mistral',
  'api.groq.com': 'groq',
  'api.together.xyz': 'together',
  'openrouter.ai': 'openrouter',
  'api.deepseek.com': 'deepseek',
  'api.cohere.com': 'cohere',
  'api.cohere.ai': 'cohere',
  'api.x.ai': 'xai',
  'api.fireworks.ai': 'fireworks',
  'api.perplexity.ai': 'perplexity',
};

export interface FetchInterceptionOptions {
  /** Extra hosts (optionally with port) to treat as LLM APIs, e.g. `localhost:11434` for Ollama. */
  llmHosts?: string[];
  /** Non-LLM hosts (e.g. a search API) whose calls are recorded as `http <host>` tools. */
  httpHosts?: string[];
}

/** Adds hosts to intercept. Safe to call at any time. */
export function configureFetchInterception(options: FetchInterceptionOptions): void {
  for (const host of options.llmHosts ?? []) runtime.fetch.llmHosts.set(host.toLowerCase(), host.toLowerCase());
  for (const host of options.httpHosts ?? []) runtime.fetch.httpHosts.add(host.toLowerCase());
}

type Target = { kind: 'llm'; provider: string } | { kind: 'http' };

function classify(url: URL): Target | null {
  const host = url.host.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const provider =
    LLM_HOSTS[hostname] ??
    (hostname.endsWith('.openai.azure.com') ? 'azure-openai' : undefined) ??
    runtime.fetch.llmHosts.get(host) ??
    runtime.fetch.llmHosts.get(hostname);
  if (provider) return { kind: 'llm', provider };
  if (runtime.fetch.httpHosts.has(host) || runtime.fetch.httpHosts.has(hostname)) return { kind: 'http' };
  return null;
}

const SECRET_PARAM = /key|token|secret|sig|auth|password|credential/i;

/** Path plus query, with secret-looking query values redacted (e.g. Gemini's `?key=`). */
export function safePath(url: URL): string {
  const params = [...url.searchParams].map(([k, v]): [string, string] => [k, SECRET_PARAM.test(k) ? '[redacted]' : v]);
  const query = new URLSearchParams(params).toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

function parseMaybeJson(text: string): Json {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return text;
  }
}

async function readRequestBody(input: string | URL | Request, init: RequestInit | undefined): Promise<Json> {
  const body = init?.body;
  let text: string;
  if (body == null) {
    if (!(input instanceof Request) || input.body === null) return null;
    text = await input.clone().text();
  } else if (typeof body === 'string') text = body;
  else if (body instanceof URLSearchParams) text = body.toString();
  else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) text = new TextDecoder().decode(body);
  else return '[unrecorded body]';
  return parseMaybeJson(text);
}

/** One server-sent event. `data` is parsed JSON when it parses, the raw string otherwise. */
export interface SseFrame {
  event?: string;
  data: Json;
}

export function parseSse(text: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let event: string | undefined;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length === 0 && event === undefined) continue;
    frames.push({ ...(event !== undefined ? { event } : {}), data: parseMaybeJson(data.join('\n')) });
  }
  return frames;
}

export function serializeSse(frames: SseFrame[]): string {
  return frames
    .map((f) => `${f.event !== undefined ? `event: ${f.event}\n` : ''}data: ${typeof f.data === 'string' ? f.data : JSON.stringify(f.data)}\n\n`)
    .join('');
}

const KEPT_HEADERS = ['content-type', 'retry-after', 'retry-after-ms'];
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

function keptHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

const isSse = (http: HttpMeta) => /text\/event-stream/i.test(http.headers['content-type'] ?? '');

async function captureHttp(live: Response): Promise<{ value: Response; body: Json; http: HttpMeta; stream: boolean }> {
  // Buffers the body (including streams) so it can be recorded.
  const text = await live.text();
  const http: HttpMeta = { status: live.status, headers: keptHeaders(live.headers) };
  const stream = isSse(http);
  const body = stream ? (parseSse(text) as unknown as Json) : parseMaybeJson(text);
  const value = new Response(NULL_BODY_STATUS.has(live.status) ? null : text, {
    status: live.status,
    statusText: live.statusText,
    headers: live.headers,
  });
  return { value, body, http, stream };
}

function reviveHttp(body: Json, http: HttpMeta, stream: boolean): Response {
  const text = stream
    ? serializeSse(body as unknown as SseFrame[])
    : typeof body === 'string'
      ? body
      : JSON.stringify(body);
  const headers: Record<string, string> = { ...http.headers };
  // Recorded failures (429, 5xx) make SDKs retry; the retries are on the
  // tape too, so tell the SDK not to sleep between them.
  if (http.status >= 400) headers['retry-after-ms'] = '0';
  return new Response(NULL_BODY_STATUS.has(http.status) ? null : text, { status: http.status, headers });
}

export const httpLlmCodec: LlmCodec = {
  async capture(live) {
    const { value, body, http, stream } = await captureHttp(live as Response);
    return { value, captured: { response: body, http, ...(stream ? { stream: true } : {}) } };
  },
  revive(captured) {
    return reviveHttp(captured.response, captured.http ?? { status: 200, headers: {} }, captured.stream === true);
  },
};

interface HttpToolResult {
  status: number;
  headers: Record<string, string>;
  body: Json;
  stream?: boolean;
}

export const httpToolCodec: ToolCodec = {
  async capture(live) {
    const { value, body, http, stream } = await captureHttp(live as Response);
    const result: HttpToolResult = { status: http.status, headers: http.headers, body, ...(stream ? { stream: true } : {}) };
    return { value, result: result as unknown as Json };
  },
  revive(result) {
    const r = result as unknown as HttpToolResult;
    return reviveHttp(r.body, { status: r.status, headers: r.headers }, r.stream === true);
  },
};

function hostsFromEnv(name: string): string[] {
  return (process.env[name] ?? '').split(',').map((h) => h.trim()).filter(Boolean);
}

/**
 * Patches `globalThis.fetch`. Outside a session, and for hosts that are not
 * intercepted, it delegates straight to the original fetch.
 *
 * SDKs capture `fetch` when a client is constructed, so this must run before
 * clients are created: importing `tapedeck` installs it, and the CLI preloads
 * it into recorded commands.
 */
export function installFetchInterceptor(): void {
  const original = runtime.originals.fetch;
  if (runtime.fetch.installed || typeof original !== 'function') return;
  configureFetchInterception({
    llmHosts: hostsFromEnv('TAPEDECK_LLM_HOSTS'),
    httpHosts: hostsFromEnv('TAPEDECK_HTTP_HOSTS'),
  });

  globalThis.fetch = async function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const session = currentSession();
    if (!session) return original(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    const target = classify(url);
    if (!target) return original(input, init);

    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = await readRequestBody(input, init);
    const invoke = () => original(input, init);
    if (target.kind === 'llm') {
      const call = { provider: target.provider, operation: `${method} ${safePath(url)}`, request: body };
      return (await session.llm(call, invoke, httpLlmCodec)) as Response;
    }
    const args = { method, url: `${url.origin}${safePath(url)}`, body };
    return (await session.tool(`http ${url.host}`, args, invoke, httpToolCodec)) as Response;
  };
  runtime.fetch.installed = true;
}

/** Restores the original `globalThis.fetch`. */
export function uninstallFetchInterceptor(): void {
  if (!runtime.fetch.installed || !runtime.originals.fetch) return;
  globalThis.fetch = runtime.originals.fetch;
  runtime.fetch.installed = false;
}
