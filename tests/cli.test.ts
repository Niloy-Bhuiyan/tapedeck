import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main, type CliIO } from '../src/cli/main.js';
import { quoteCommand } from '../src/process.js';
import { readTapeFile, writeTapeFile } from '../src/tape/io.js';

const fixture = join(import.meta.dirname, 'fixtures', 'env-agent.ts');
const agentArgs = (...args: string[]) => [process.execPath, '--import', 'tsx', fixture, ...args];

async function cli(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const io: CliIO = { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), color: false };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

describe('tapedeck CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapedeck-cli-'));
  const tapeA = join(dir, 'a.tape.json');

  it('prints help and version', async () => {
    expect((await cli('--help')).stdout).toContain('tapedeck record');
    expect((await cli()).code).toBe(0);
    expect((await cli('--version')).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('rejects unknown commands and bad options with exit code 2', async () => {
    const unknown = await cli('rewind');
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('unknown command "rewind"');
    expect((await cli('diff', 'only-one')).code).toBe(2);
    expect((await cli('diff', 'a', 'b', '--bogus')).code).toBe(2);
    expect((await cli('record')).stderr).toContain('missing command');
  });

  it('records a command', async () => {
    const res = await cli('record', '-o', tapeA, '-n', 'cli demo', '--', ...agentArgs('alpha'));
    expect(res.code).toBe(0);
    expect(res.stderr).toContain(`Recorded 5 events → ${tapeA}`);
    const tape = readTapeFile(tapeA);
    expect(tape.name).toBe('cli demo');
    expect(tape.metadata.command).toBe(quoteCommand(agentArgs('alpha')));
  });

  it('replays a tape standalone as a timeline', async () => {
    const res = await cli('replay', tapeA);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Tape cli demo');
    expect(res.stdout).toMatch(/llm_call +openai chat\.completions\.create/);
    expect(res.stdout).toContain('Outcome: ok exit code 0');
    expect(JSON.parse((await cli('replay', tapeA, '--json')).stdout).id).toBe(readTapeFile(tapeA).id);
  });

  it('replays a tape against a command and exits 0 when it matches', async () => {
    const out = join(dir, 'replayed.tape.json');
    const res = await cli('replay', tapeA, '--against', quoteCommand(agentArgs('alpha')), '-o', out);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Tapes match: all 5 steps are identical.');
    expect(readTapeFile(out).metadata.replay?.sourceTapeId).toBe(readTapeFile(tapeA).id);
  });

  it('reports the first divergence and exits 1 when the command changed', async () => {
    const res = await cli('replay', tapeA, '--against', quoteCommand(agentArgs('beta')));
    expect(res.code).toBe(1);
    expect(res.stdout).toContain('1 divergence(s) during replay');
    expect(res.stdout).toContain('request.q: "alpha" → "beta"');
    expect(res.stdout).toContain('Tapes diverge at step 2 of 5.');

    const json = JSON.parse((await cli('replay', tapeA, '--against', quoteCommand(agentArgs('beta')), '--json')).stdout);
    expect(json.ok).toBe(false);
    expect(json.diff.firstDivergence.key).toBe('llm_call:openai:chat.completions.create');
  });

  it('diffs two tapes', async () => {
    const tapeB = join(dir, 'b.tape.json');
    await cli('record', '-o', tapeB, '--', ...agentArgs('beta'));
    const same = await cli('diff', tapeA, tapeA);
    expect(same.code).toBe(0);
    expect(same.stdout).toContain('Tapes match');

    const res = await cli('diff', tapeA, tapeB);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain('request.q: "alpha" → "beta"');

    const json = JSON.parse((await cli('diff', tapeA, tapeB, '--json')).stdout);
    expect(json.equal).toBe(false);
  });

  it('can ignore event types when diffing', async () => {
    const tape = readTapeFile(tapeA);
    const noClock = { ...tape, events: tape.events.filter((e) => e.type !== 'clock_read').map((e, seq) => ({ ...e, seq })) };
    const path = join(dir, 'no-clock.tape.json');
    writeTapeFile(path, noClock);
    expect((await cli('diff', tapeA, path)).code).toBe(1);
    expect((await cli('diff', tapeA, path, '--ignore', 'clock_read')).code).toBe(0);
    expect((await cli('diff', tapeA, path, '--ignore', 'sundial')).stderr).toContain('unknown event type "sundial"');
  });

  it('reports unreadable tapes with exit code 1', async () => {
    const res = await cli('replay', join(dir, 'missing.tape.json'));
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('ENOENT');
  });

  it('runs as an executable', () => {
    const child = spawnSync(process.execPath, ['--import', 'tsx', join('src', 'cli', 'bin.ts'), 'diff', tapeA, tapeA], {
      encoding: 'utf8',
    });
    expect(child.status).toBe(0);
    expect(child.stdout).toContain('Tapes match');
  });
});
