import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wrapOpenAI } from '../src/interceptors/providers.js';
import { tool } from '../src/interceptors/tool.js';
import { MockOpenAI } from '../src/mock/openai.js';
import { quoteCommand, recordCommand } from '../src/process.js';
import { record } from '../src/record.js';
import { replayTape, tapeMatchers } from '../src/testing/vitest.js';

function agent(topic: string) {
  const openai = wrapOpenAI(new MockOpenAI());
  const lookup = tool('lookup', async (q: string) => `facts about ${q}`);
  return async () => {
    const facts = await lookup(topic);
    const res = await openai.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: facts }] });
    return res.choices[0]!.message.content;
  };
}

describe('toMatchTape', () => {
  it('passes when an in-process replay reproduces the tape', async () => {
    const { tape } = await record(agent('tapes'), { name: 'lookup-flow' });
    expect(await replayTape(tape, agent('tapes'))).toMatchTape();
  });

  it('fails with a readable diff when behaviour changed', async () => {
    const { tape } = await record(agent('tapes'), { name: 'lookup-flow' });
    const replayed = await replayTape(tape, { run: agent('cassettes') });
    expect(replayed).not.toMatchTape();

    const result = tapeMatchers.toMatchTape(replayed);
    expect(result.pass).toBe(false);
    const message = result.message();
    expect(message).toContain('Replay of tape "lookup-flow" did not match the recording.');
    expect(message).toContain('Divergences during replay:');
    expect(message).toContain('args: "tapes" → "cassettes"');
    expect(message).toContain('Tapes diverge at step 1 of');
  });

  it('accepts diff options to relax the comparison', async () => {
    const run = async () => Date.now();
    const { tape } = await record(run);
    const replayed = await replayTape(tape, async () => [Date.now(), Date.now()][0]);
    expect(replayed).not.toMatchTape();
    expect(replayed).toMatchTape({ ignoreTypes: ['clock_read'] });
  });

  it('rejects values that are not replays', () => {
    expect(tapeMatchers.toMatchTape({ nope: true }).message()).toContain('expects the result of replayTape()');
    expect({}).not.toMatchTape();
  });
});

describe('replayTape with commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapedeck-testing-'));
  const fixture = join(import.meta.dirname, 'fixtures', 'env-agent.ts');
  const command = (arg: string) => quoteCommand([process.execPath, '--import', 'tsx', fixture, arg]);

  it('re-runs the recorded command from a tape file', async () => {
    const path = join(dir, 'cmd.tape.json');
    await recordCommand(command('same'), { output: path, stdio: 'pipe' });
    expect(await replayTape(path)).toMatchTape();
  });

  it('can run a different command against the tape', async () => {
    const path = join(dir, 'cmd2.tape.json');
    await recordCommand(command('before'), { output: path, stdio: 'pipe' });
    const replayed = await replayTape(path, { command: command('after') });
    expect(replayed).not.toMatchTape();
    expect(replayed.diff.firstDivergence?.changes[0]).toMatchObject({ path: 'request.q', a: 'before', b: 'after' });
  });

  it('explains when a tape has no command and no run function', async () => {
    const { tape } = await record(() => 1);
    await expect(replayTape(tape)).rejects.toThrow(/no recorded command/);
  });
});
