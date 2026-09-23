import { preview } from '../diff/deep.js';
import type { Json, TapeEvent } from '../tape/schema.js';

type Obj = { [key: string]: Json };
const isObj = (v: Json | undefined): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArray = (v: Json | undefined): Json[] => (Array.isArray(v) ? v : []);

/** Pulls text and tool-call names out of OpenAI- or Anthropic-shaped responses. */
function describeLlmResponse(response: Json | undefined): string {
  if (!isObj(response)) return preview(response);
  // OpenAI chat completions: { choices: [{ message: { content, tool_calls } }] }
  const first = asArray(response.choices)[0];
  const message = isObj(first) && isObj(first.message) ? first.message : undefined;
  if (message) {
    const tools = asArray(message.tool_calls)
      .map((c) => (isObj(c) && isObj(c.function) ? String(c.function.name) : '?'))
      .filter(Boolean);
    if (tools.length) return `→ tool calls: ${tools.join(', ')}`;
    return `→ ${preview(message.content ?? null)}`;
  }
  // Anthropic messages: { content: [{ type: 'text', text } | { type: 'tool_use', name }] }
  const blocks = asArray(response.content).filter(isObj);
  if (blocks.length) {
    const tools = blocks.filter((b) => b.type === 'tool_use').map((b) => String(b.name));
    if (tools.length) return `→ tool calls: ${tools.join(', ')}`;
    const text = blocks.filter((b) => b.type === 'text').map((b) => String(b.text)).join(' ');
    return `→ ${preview(text)}`;
  }
  return `→ ${preview(response)}`;
}

/** One-line, human-oriented description of an event's content. */
export function summarizeEvent(event: TapeEvent): string {
  switch (event.type) {
    case 'llm_call': {
      const model = isObj(event.request) && typeof event.request.model === 'string' ? ` model=${event.request.model}` : '';
      const outcome = event.error
        ? `✗ ${event.error.name}: ${event.error.message}`
        : event.stream
          ? `→ ${asArray(event.response).length} streamed chunks`
          : describeLlmResponse(event.response);
      return `${event.provider} ${event.operation}${model} ${outcome}`;
    }
    case 'tool_call':
      return `${event.tool}(${preview(event.args)})`;
    case 'tool_result':
      return event.error ? `${event.tool} ✗ ${event.error.name}: ${event.error.message}` : `${event.tool} → ${preview(event.result)}`;
    case 'clock_read':
      return `${event.source} → ${new Date(event.value).toISOString()}`;
    case 'random_draw':
      return `Math.random → ${event.value}`;
  }
}
