// MOCK: a deterministic stand-in for a real model's reasoning, used when no
// OPENAI_API_KEY is set. It follows the same plan a capable model would:
// search for each place in the question, compute with the calculator, then
// answer. With a real key, `main.ts` uses the real OpenAI client instead.
import type { MockChatParams, MockReply } from '../../src/index.js';
import { KNOWN_PLACES } from './tools.js';

type Message = MockChatParams['messages'][number];

const NUMBER = /population ([\d,]+); area ([\d,]+) km²/;
const toNumber = (text: string) => Number(text.replace(/,/g, ''));

function toolOutputs(messages: Message[], name: string): string[] {
  // Map tool_call ids to tool names from the assistant messages, then pick outputs.
  const names = new Map<string, string>();
  for (const m of messages) {
    for (const call of (m.tool_calls as Array<{ id: string; function: { name: string } }> | undefined) ?? []) {
      names.set(call.id, call.function.name);
    }
  }
  return messages
    .filter((m) => m.role === 'tool' && names.get(String(m.tool_call_id)) === name)
    .map((m) => String(m.content));
}

export function researchBrain(params: MockChatParams): MockReply {
  const question = String(params.messages.find((m) => m.role === 'user')?.content ?? '');
  const places = KNOWN_PLACES.filter((p) => question.toLowerCase().includes(p));
  const searches = toolOutputs(params.messages, 'web_search');
  const calculations = toolOutputs(params.messages, 'calculator');

  if (places.length === 0) return { text: "I can only research places I know about, sorry." };

  // 1. Look every place up (as parallel tool calls).
  if (searches.length === 0) {
    return {
      text: null,
      toolCalls: places.map((place) => ({ name: 'web_search', input: { query: `${place} population and area` } })),
    };
  }

  // 2. Pull the figures out of the search results and compute density.
  const figures = searches.join('\n').match(new RegExp(NUMBER, 'g')) ?? [];
  const parsed = figures.map((f) => f.match(NUMBER)!).map((m) => ({ population: toNumber(m[1]!), area: toNumber(m[2]!) }));
  const population = parsed.map((p) => p.population).join(' + ');
  const area = parsed.map((p) => p.area).join(' + ');
  if (calculations.length === 0) {
    return { text: null, toolCalls: [{ name: 'calculator', input: { expression: `(${population}) / (${area})` } }] };
  }

  // 3. Answer.
  const { result } = JSON.parse(calculations[0]!) as { result: number };
  const total = parsed.reduce((sum, p) => sum + p.population, 0);
  const totalArea = parsed.reduce((sum, p) => sum + p.area, 0);
  return {
    text:
      `Together ${places.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(' and ')} have about ` +
      `${total.toLocaleString('en-US')} people on ${totalArea.toLocaleString('en-US')} km², ` +
      `which is roughly ${result.toLocaleString('en-US')} people per km².`,
  };
}
