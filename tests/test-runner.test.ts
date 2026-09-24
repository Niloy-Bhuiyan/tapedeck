import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { main, type CliIO } from '../src/cli/main.js';
import { findTapes, githubAnnotations, markdownSummary, runTapeTests } from '../src/cli/test-runner.js';
import { quoteCommand, recordCommand } from '../src/process.js';
import { record } from '../src/record.js';
import { readTapeFile, writeTapeFile } from '../src/tape/io.js';

const fixture = join(import.meta.dirname, 'fixtures', 'env-agent.ts');
const agent = (arg: string) => quoteCommand([process.execPath, '--import', 'tsx', fixture, arg]);

let dir: string;

/** Records a tape, then points it at a different command to simulate a code change. */
async function tapeWithCodeChange(path: string, recordedArg: string, currentArg: string) {
  await recordCommand(agent(recordedArg), { output: path, name: `agent-${recordedArg}`, stdio: 'pipe' });
  const tape = readTapeFile(path);
  tape.metadata.command = agent(currentArg);
  writeTapeFile(path, tape);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tapedeck-test-runner-'));
  mkdirSync(join(dir, 'nested'));
  mkdirSync(join(dir, 'node_modules'));
  await recordCommand(agent('stable'), { output: join(dir, 'stable.tape.json'), name: 'stable', stdio: 'pipe' });
  await tapeWithCodeChange(join(dir, 'nested', 'changed.tape.json'), 'before', 'after');
  writeTapeFile(join(dir, 'in-process.tape.json'), (await record(() => 1, { name: 'in-process' })).tape);
  writeFileSync(join(dir, 'broken.tape.json'), '{ not json');
  writeFileSync(join(dir, 'node_modules', 'ignored.tape.json'), '{}');
  writeFileSync(join(dir, 'notes.json'), '{}');
});

describe('findTapes', () => {
  it('finds tape files recursively, skipping node_modules and other files', () => {
    const found = findTapes([dir]).map((p) => p.slice(dir.length + 1).split('\\').join('/'));
    expect(found).toEqual(['broken.tape.json', 'in-process.tape.json', 'nested/changed.tape.json', 'stable.tape.json']);
  });
});

describe('runTapeTests', () => {
  it('reports pass, fail, skip and error per tape, with HTML reports for failures', async () => {
    const reportDir = join(dir, 'reports');
    const results = await runTapeTests([dir], { reportDir });
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));

    expect(byName['stable']).toMatchObject({ status: 'pass', steps: 5 });
    expect(byName['agent-before']).toMatchObject({ status: 'fail' });
    expect(byName['agent-before']!.detail).toContain('request.q: "before" → "after"');
    expect(existsSync(byName['agent-before']!.report!)).toBe(true);
    expect(byName['in-process']).toMatchObject({ status: 'skip' });
    expect(byName['broken.tape.json']).toMatchObject({ status: 'error' });
  });

  it('re-records changed tapes with --update, after which they pass', async () => {
    const path = join(dir, 'update-me.tape.json');
    await tapeWithCodeChange(path, 'old', 'new');

    const [updated] = await runTapeTests([path], { update: true });
    expect(updated).toMatchObject({ status: 'updated', name: 'agent-old' });
    const tape = readTapeFile(path);
    expect(tape.name).toBe('agent-old');
    expect(tape.metadata.command).toBe(agent('new'));

    const [rerun] = await runTapeTests([path]);
    expect(rerun!.status).toBe('pass');
  });
});

describe('summaries', () => {
  const results = [
    { path: join(process.cwd(), 'tapes', 'a.tape.json'), name: 'a', status: 'pass' as const, durationMs: 12, steps: 4 },
    {
      path: join(process.cwd(), 'tapes', 'b.tape.json'),
      name: 'b',
      status: 'fail' as const,
      durationMs: 30,
      steps: 6,
      detail: 'Tapes diverge at step 2 of 6.\n100% different',
    },
  ];

  it('renders a Markdown table with failure details', () => {
    const md = markdownSummary(results);
    expect(md).toContain('## ❌ TapeDeck: 1 passed, 1 failed');
    expect(md).toContain('| ✅ | `tapes/a.tape.json` | 4 | 12 ms |');
    expect(md).toContain('<details><summary>❌ <b>b</b></summary>');
    expect(md).toContain('tapedeck test --update');
  });

  it('emits escaped GitHub annotations for failures only', () => {
    expect(githubAnnotations(results)).toEqual([
      '::error file=tapes/b.tape.json,title=TapeDeck: b diverged::Tapes diverge at step 2 of 6.%0A100%25 different',
    ]);
  });
});

describe('tapedeck test (CLI)', () => {
  const run = async (...argv: string[]) => {
    let stdout = '';
    let stderr = '';
    const io: CliIO = { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), color: false };
    return { code: await main(['test', ...argv], io), stdout, stderr };
  };

  it('exits 0 when every tape matches', async () => {
    const res = await run(join(dir, 'stable.tape.json'));
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('✓ stable');
    expect(res.stdout).toContain('Tapes: 1 passed');
  });

  it('exits 1 and explains when a tape changed, and writes Markdown on request', async () => {
    const markdown = join(dir, 'summary.md');
    const res = await run(join(dir, 'nested'), '--markdown', markdown);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain('✗ agent-before');
    expect(res.stdout).toContain('Intended change? Re-record with: tapedeck test --update');
    expect(readFileSync(markdown, 'utf8')).toContain('TapeDeck: 0 passed, 1 failed');
  });

  it('fails when no tapes are found', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'tapedeck-empty-'));
    const res = await run(empty);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('no tapes');
  });
});
