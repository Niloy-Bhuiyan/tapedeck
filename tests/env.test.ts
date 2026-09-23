import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTapeFile } from '../src/tape/io.js';

const fixture = join(import.meta.dirname, 'fixtures', 'env-agent.ts');

function run(env: Record<string, string>, ...args: string[]) {
  const child = spawnSync(process.execPath, ['--import', 'tsx', fixture, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: child.stdout.trim(), stderr: child.stderr, status: child.status };
}

describe('environment-driven sessions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapedeck-env-'));

  it('records a whole process and replays it with identical output', () => {
    const tapePath = join(dir, 'proc.tape.json');
    const recorded = run({ TAPEDECK_MODE: 'record', TAPEDECK_OUTPUT: tapePath, TAPEDECK_NAME: 'proc', TAPEDECK_COMMAND: 'env-agent' });
    expect(recorded.status).toBe(0);

    const tape = readTapeFile(tapePath);
    expect(tape.name).toBe('proc');
    expect(tape.metadata.command).toBe('env-agent');
    expect(tape.outcome).toEqual({ status: 'ok', exitCode: 0 });
    expect(tape.events.map((e) => e.type)).toEqual(['clock_read', 'llm_call', 'tool_call', 'tool_result', 'random_draw']);

    const actualPath = join(dir, 'proc.replay.tape.json');
    const replayed = run({ TAPEDECK_MODE: 'replay', TAPEDECK_TAPE: tapePath, TAPEDECK_OUTPUT: actualPath });
    expect(replayed.status).toBe(0);
    expect(replayed.stdout).toBe(recorded.stdout);
    expect(readTapeFile(actualPath).metadata.replay).toMatchObject({ sourceTapeId: tape.id, divergences: [] });
  });

  it('records the exit code as the outcome', () => {
    const tapePath = join(dir, 'fail.tape.json');
    const result = run({ TAPEDECK_MODE: 'record', TAPEDECK_OUTPUT: tapePath }, 'hi', 'fail');
    expect(result.status).toBe(3);
    expect(readTapeFile(tapePath).outcome).toEqual({ status: 'error', exitCode: 3 });
  });

  it('fails a strict replay when the process diverges, and still writes the replay tape', () => {
    const tapePath = join(dir, 'base.tape.json');
    run({ TAPEDECK_MODE: 'record', TAPEDECK_OUTPUT: tapePath }, 'first');
    const actualPath = join(dir, 'diverged.tape.json');
    const result = run({ TAPEDECK_MODE: 'replay', TAPEDECK_TAPE: tapePath, TAPEDECK_OUTPUT: actualPath }, 'second');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('TapeDivergenceError');
    const divergences = readTapeFile(actualPath).metadata.replay?.divergences ?? [];
    expect(divergences[0]).toMatchObject({ kind: 'mismatched_call' });
  });

  it('does nothing when no mode is set', () => {
    const result = run({});
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).doubled).toBe(42);
  });
});
