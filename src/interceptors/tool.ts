import { currentSession } from '../runtime/context.js';

/**
 * Wraps an agent tool so its calls and results are recorded, and replayed
 * without running the tool.
 *
 * Tools take a single JSON-serializable input (the shape LLM tool calling
 * produces) and may be sync or async. Outside a session the wrapper just
 * calls through.
 *
 * @example
 * const search = tool('web_search', async ({ query }: { query: string }) => fetchResults(query));
 */
export function tool<I, O>(name: string, fn: (input: I) => O | Promise<O>): (input: I) => Promise<O> {
  return async (input: I): Promise<O> => {
    const session = currentSession();
    if (!session) return fn(input);
    return (await session.tool(name, input, async () => fn(input))) as O;
  };
}
