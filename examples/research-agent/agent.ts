// A small research assistant: an OpenAI tool-calling loop over two tools.
// Nothing here is TapeDeck-specific except that the client and tools are
// wrapped, which is all TapeDeck needs to record and replay the agent.
import { calculator, TOOL_SPECS, webSearch } from './tools.js';

/** The slice of the OpenAI client this agent uses (satisfied by `OpenAI` and `MockOpenAI`). */
export interface ChatClient {
  chat: {
    completions: {
      create(params: any): Promise<{
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
          };
        }>;
      }>;
    };
  };
}

export interface AgentOptions {
  client: ChatClient;
  model?: string;
  /**
   * "v2" simulates a well-meaning refactor that changes how search results
   * are shown to the model — the kind of regression TapeDeck catches.
   */
  variant?: 'v1' | 'v2';
  maxSteps?: number;
}

export interface AgentResult {
  runId: string;
  question: string;
  answer: string | null;
  toolCalls: string[];
  startedAt: string;
  elapsedMs: number;
}

export const DEFAULT_QUESTION =
  'What is the combined population of Tokyo and Delhi, and how many people per square kilometre is that?';

export const SYSTEM_PROMPT =
  'You are a careful research assistant. Use web_search to find facts and calculator for arithmetic. ' +
  'Answer in one sentence.';

const tools: Record<string, (input: any) => Promise<unknown>> = { web_search: webSearch, calculator };

export function createResearchAgent(options: AgentOptions) {
  const { client, model = 'gpt-4.1-mini', variant = 'v1', maxSteps = 6 } = options;

  function formatToolOutput(name: string, output: unknown): string {
    if (variant === 'v2' && name === 'web_search') {
      // The "refactor": plain-text snippets instead of JSON.
      return (output as Array<{ snippet: string }>).map((r) => `- ${r.snippet}`).join('\n');
    }
    return JSON.stringify(output);
  }

  return async function run(question: string): Promise<AgentResult> {
    const started = Date.now();
    const runId = `run_${Math.random().toString(36).slice(2, 10)}`;
    const messages: any[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: question },
    ];
    const toolCalls: string[] = [];

    for (let step = 0; step < maxSteps; step++) {
      const response = await client.chat.completions.create({ model, messages, tools: TOOL_SPECS, temperature: 0 });
      const message = response.choices[0]!.message;
      messages.push(message);

      if (!message.tool_calls?.length) {
        return {
          runId,
          question,
          answer: message.content,
          toolCalls,
          startedAt: new Date(started).toISOString(),
          elapsedMs: Date.now() - started,
        };
      }

      for (const call of message.tool_calls) {
        const impl = tools[call.function.name];
        const output = impl
          ? await impl(JSON.parse(call.function.arguments))
          : { error: `Unknown tool ${call.function.name}` };
        toolCalls.push(call.function.name);
        messages.push({ role: 'tool', tool_call_id: call.id, content: formatToolOutput(call.function.name, output) });
      }
    }
    throw new Error(`Agent gave up after ${maxSteps} steps`);
  };
}
