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

/**
 * Reassembles text and tool-call names from streamed chunks: SDK chunk
 * objects, or SSE frames (`{ event?, data }`) captured at the fetch level.
 */
function describeStream(response: Json | undefined): string {
  const items = asArray(response);
  let text = '';
  const tools: string[] = [];
  for (const item of items) {
    const data = isObj(item) && 'data' in item ? item.data : item;
    if (!isObj(data)) continue;
    // OpenAI: { choices: [{ delta: { content, tool_calls } }] }
    const choice = asArray(data.choices)[0];
    const delta = isObj(choice) && isObj(choice.delta) ? choice.delta : undefined;
    if (delta && typeof delta.content === 'string') text += delta.content;
    for (const call of asArray(delta?.tool_calls)) {
      if (isObj(call) && isObj(call.function) && typeof call.function.name === 'string') tools.push(call.function.name);
    }
    // Anthropic: content_block_delta { delta: { text } } / content_block_start { content_block: tool_use }
    if (isObj(data.delta) && typeof data.delta.text === 'string') text += data.delta.text;
    if (isObj(data.content_block) && data.content_block.type === 'tool_use') tools.push(String(data.content_block.name));
  }
  if (tools.length) return `→ tool calls: ${tools.join(', ')} (streamed)`;
  if (text) return `→ ${preview(text)} (streamed)`;
  return `→ ${items.length} streamed chunks`;
}

/** One-line, human-oriented description of an event's content. */
export function summarizeEvent(event: TapeEvent): string {
  switch (event.type) {
    case 'llm_call': {
      const model = isObj(event.request) && typeof event.request.model === 'string' ? ` model=${event.request.model}` : '';
      const outcome = event.error
        ? `✗ ${event.error.name}: ${event.error.message}`
        : event.stream
          ? describeStream(event.response)
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
