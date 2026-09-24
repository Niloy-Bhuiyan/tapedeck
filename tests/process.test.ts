import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NotInstrumentedError, quoteCommand, recordCommand, replayCommand } from '../src/process.js';

const fixture = join(import.meta.dirname, 'fixtures', 'env-agent.ts');
const agent = (...args: string[]) => quoteCommand([process.execPath, '--import', 'tsx', fixture, ...args]);

describe('quoteCommand', () => {
  it('leaves simple arguments alone and quotes the rest', () => {
    expect(quoteCommand(['node', 'agent.js', '--flag=1'])).toBe('node agent.js --flag=1');
    expect(quoteCommand(['echo', 'two words'])).toBe('echo "two words"');
  });

  it('escapes embedded quotes', () => {
    expect(quoteCommand(['say', 'a "b"'])).toBe('say "a \\"b\\""');
  });
});

describe('recordCommand / replayCommand', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapedeck-process-'));

  it('records a command and replays it identically', async () => {
    const recorded = await recordCommand(agent('hello'), {
      output: join(dir, 'hello.tape.json'),
      name: 'hello',
      stdio: 'pipe',
    });
    expect(recorded.exitCode).toBe(0);
    expect(recorded.tape.name).toBe('hello');
    expect(recorded.tape.metadata.command).toBe(agent('hello'));

    const replayed = await replayCommand(agent('hello'), { tape: recorded.output, stdio: 'pipe' });
    expect(replayed.ok).toBe(true);
    expect(replayed.stdout).toBe(recorded.stdout);
    expect(replayed.diff.equal).toBe(true);
  });

  it('reports divergences when the command behaves differently', async () => {
    const { tape } = await recordCommand(agent('hello'), { output: join(dir, 'base.tape.json'), stdio: 'pipe' });
    const replayed = await replayCommand(agent('goodbye'), { tape, stdio: 'pipe' });
    expect(replayed.ok).toBe(false);
    expect(replayed.exitCode).toBe(0); // diff mode keeps going
    expect(replayed.divergences).toHaveLength(1);
    expect(replayed.diff.firstDivergence).toMatchObject({
      status: 'changed',
      changes: [{ path: 'request.q', a: 'hello', b: 'goodbye' }],
    });
  });

  it('stops at the first divergence in strict mode', async () => {
    const { tape } = await recordCommand(agent('hello'), { output: join(dir, 'strict.tape.json'), stdio: 'pipe' });
    const replayed = await replayCommand(agent('goodbye'), { tape, mode: 'strict', stdio: 'pipe' });
    expect(replayed.ok).toBe(false);
    expect(replayed.exitCode).not.toBe(0);
    expect(replayed.stderr).toContain('TapeDivergenceError');
  });

  it('explains when the command is not a Node.js program', async () => {
    const plain = 'echo not-node';
    await expect(recordCommand(plain, { output: join(dir, 'none.tape.json'), stdio: 'pipe' })).rejects.toThrow(
      NotInstrumentedError,
    );
  });
});
