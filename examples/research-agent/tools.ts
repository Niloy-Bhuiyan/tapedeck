// The research assistant's tools. In your own project, import from 'tapedeck'.
import { tool } from '../../src/index.js';

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

// MOCK: a tiny canned "web" so the example runs offline. Replace with a real
// search API (e.g. Brave, Bing, Tavily) to make the agent genuinely useful.
const MOCK_INDEX: Record<string, SearchResult> = {
  tokyo: {
    title: 'Tokyo – population and area',
    snippet: 'Tokyo metropolis: population 14,094,034; area 2,194 km².',
    url: 'https://example.com/tokyo',
  },
  delhi: {
    title: 'Delhi – population and area',
    snippet: 'National Capital Territory of Delhi: population 16,787,941; area 1,484 km².',
    url: 'https://example.com/delhi',
  },
  paris: {
    title: 'Paris – population and area',
    snippet: 'City of Paris: population 2,102,650; area 105 km².',
    url: 'https://example.com/paris',
  },
  lagos: {
    title: 'Lagos – population and area',
    snippet: 'Lagos State: population 15,388,000; area 3,577 km².',
    url: 'https://example.com/lagos',
  },
};

export const KNOWN_PLACES = Object.keys(MOCK_INDEX);

// MOCK: see MOCK_INDEX above.
export const webSearch = tool('web_search', async ({ query }: { query: string }): Promise<SearchResult[]> => {
  const q = query.toLowerCase();
  return KNOWN_PLACES.filter((place) => q.includes(place)).map((place) => MOCK_INDEX[place]!);
});

/**
 * A real (not mocked) calculator: evaluates + - * / and parentheses with a
 * small recursive-descent parser, so no `eval` is involved.
 */
export function evaluate(expression: string): number {
  // Numbers may use thousands separators ("14,094,034"); anything else unknown is an error.
  const tokens = expression.match(/\d[\d,]*(?:\.\d+)?|[-+*/()]|\S/g) ?? [];
  const bad = tokens.find((t) => !/^(\d[\d,]*(\.\d+)?|[-+*/()])$/.test(t));
  if (bad) throw new Error(`Invalid character "${bad}" in expression: ${expression}`);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const primary = (): number => {
    const token = next();
    if (token === '(') {
      const value = sum();
      if (next() !== ')') throw new Error('Expected )');
      return value;
    }
    if (token === '-') return -primary();
    if (token === undefined || !/^\d/.test(token)) throw new Error(`Unexpected ${token ?? 'end of input'}`);
    return Number(token.replace(/,/g, ''));
  };
  const product = (): number => {
    let value = primary();
    while (peek() === '*' || peek() === '/') value = next() === '*' ? value * primary() : value / primary();
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (peek() === '+' || peek() === '-') value = next() === '+' ? value + product() : value - product();
    return value;
  };

  const value = sum();
  if (pos !== tokens.length) throw new Error(`Unexpected ${peek()}`);
  return value;
}

export const calculator = tool('calculator', async ({ expression }: { expression: string }) => ({
  expression,
  result: Math.round(evaluate(expression) * 100) / 100,
}));

/** Tool definitions in OpenAI's function-calling format. */
export const TOOL_SPECS = [
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: 'Search the web and return result snippets.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'calculator',
      description: 'Evaluate an arithmetic expression using + - * / and parentheses.',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: 'e.g. (1 + 2) / 3' } },
        required: ['expression'],
      },
    },
  },
];
