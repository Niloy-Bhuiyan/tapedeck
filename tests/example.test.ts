/**
 * The research-agent example doubles as this repo's end-to-end fixture:
 * its committed tape must keep replaying cleanly against the current code.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createResearchAgent, DEFAULT_QUESTION } from '../examples/research-agent/agent.js';
import { researchBrain } from '../examples/research-agent/mock-brain.js';
import { evaluate } from '../examples/research-agent/tools.js';
import { wrapOpenAI } from '../src/interceptors/providers.js';
import { MockOpenAI } from '../src/mock/openai.js';
import { readTapeFile } from '../src/tape/io.js';
import { replayTape } from '../src/testing/vitest.js';

const TAPE = join(import.meta.dirname, '..', 'examples', 'research-agent', 'tapes', 'research-agent.tape.json');

function agent(variant: 'v1' | 'v2' = 'v1') {
  // Replay never calls the client, but the agent needs one to call.
  const client = wrapOpenAI(new MockOpenAI({ responder: researchBrain })) as any;
  const run = createResearchAgent({ client, variant });
  return () => run(DEFAULT_QUESTION);
}

describe('research-agent example', () => {
  it('ships a valid tape with the full tool-calling run', () => {
    const tape = readTapeFile(TAPE);
    expect(tape.name).toBe('research-agent');
    expect(tape.metadata.command).toBe('node --import tsx examples/research-agent/main.ts');
    expect(tape.events.filter((e) => e.type === 'llm_call')).toHaveLength(3);
    expect(tape.events.filter((e) => e.type === 'tool_call').map((e) => (e as { tool: string }).tool)).toEqual([
      'web_search',
      'web_search',
      'calculator',
    ]);
  });

  it('replays in-process, offline, and matches the tape', async () => {
    const replayed = await replayTape(TAPE, agent());
    expect(replayed).toMatchTape();
    // The clock and Math.random come back exactly as recorded.
    const tape = readTapeFile(TAPE);
    const clock = tape.events.find((e) => e.type === 'clock_read') as { value: number };
    expect((replayed as any).result.startedAt).toBe(new Date(clock.value).toISOString());
  });

  it('replays the recorded command and matches the tape', async () => {
    expect(await replayTape(TAPE)).toMatchTape();
  });

  it('catches the v2 prompt-formatting regression', async () => {
    const replayed = await replayTape(TAPE, agent('v2'));
    expect(replayed).not.toMatchTape();
    expect(replayed.diff.firstDivergence).toMatchObject({
      status: 'changed',
      key: 'llm_call:openai:chat.completions.create',
    });
    expect(replayed.diff.firstDivergence!.changes.map((c) => c.path)).toEqual([
      'request.messages[3].content',
      'request.messages[4].content',
    ]);
  });

  it('catches the same regression through the recorded command', async () => {
    const replayed = await replayTape(TAPE, {
      command: 'node --import tsx examples/research-agent/main.ts --variant=v2',
    });
    expect(replayed).not.toMatchTape();
    expect(replayed.diff.summary).toContain('was sent a different request');
  });
});

describe('calculator', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 / 4', 2.5],
    ['-(2 + 3) * 2', -10],
    ['1,000 + 1', 1001],
  ])('evaluates %s', (expr, expected) => {
    expect(evaluate(expr)).toBe(expected);
  });

  it.each(['2 +', 'process.exit()', '(1 + 2', '1 2'])('rejects %s', (expr) => {
    expect(() => evaluate(expr)).toThrow();
  });
});
