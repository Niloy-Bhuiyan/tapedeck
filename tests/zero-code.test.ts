/**
 * The headline feature: record and replay an agent that has no TapeDeck
 * code in it, purely through the CLI.
 */
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main, type CliIO } from '../src/cli/main.js';
import { quoteCommand, recordCommand, replayCommand } from '../src/process.js';
import type { LlmCallEvent } from '../src/tape/schema.js';

const fixture = join(import.meta.dirname, 'fixtures', 'plain-agent.mjs');
let server: Server;
let baseURL: string;
let host: string;
let hits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hits++;
      const params = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `chatcmpl-${hits}`,
          object: 'chat.completion',
          created: 1,
          model: params.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: `Pack light for: ${params.messages[1].content}` },
              finish_reason: 'stop',
              logprobs: null,
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  baseURL = `http://${host}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const agent = (question: string) => quoteCommand(['node', fixture, baseURL, question]);

describe('zero-code record/replay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapedeck-zero-'));

  it('records an unmodified Node.js agent', async () => {
    const run = await recordCommand(agent('a beach trip'), {
      output: join(dir, 'plain.tape.json'),
      llmHosts: [host],
      stdio: 'pipe',
    });
    expect(run.exitCode).toBe(0);
    expect(run.tape.events.map((e) => e.type)).toEqual(['clock_read', 'random_draw', 'llm_call']);
    expect(run.tape.events[2]).toMatchObject({ provider: host, operation: 'POST /v1/chat/completions' });
    expect(run.tape.metadata.llmHosts).toEqual([host]);
    expect(JSON.stringify(run.tape)).not.toContain('sk-local-test');
  });

  it('replays it offline with identical output, including the date and random ID', async () => {
    const tape = join(dir, 'replayable.tape.json');
    const recorded = await recordCommand(agent('a ski trip'), { output: tape, llmHosts: [host], stdio: 'pipe' });
    const before = hits;
    await new Promise((r) => setTimeout(r, 20));

    // Hosts come from the tape's metadata; no flags needed.
    const replayed = await replayCommand(agent('a ski trip'), { tape, stdio: 'pipe' });
    expect(replayed.ok).toBe(true);
    expect(replayed.stdout).toBe(recorded.stdout);
    expect(hits).toBe(before);
  });

  it('pinpoints a prompt change in the unmodified agent', async () => {
    const tape = join(dir, 'changed.tape.json');
    await recordCommand(agent('a beach trip'), { output: tape, llmHosts: [host], stdio: 'pipe' });
    const replayed = await replayCommand(agent('a city break'), { tape, stdio: 'pipe' });
    expect(replayed.ok).toBe(false);
    expect(replayed.diff.firstDivergence?.changes).toEqual([
      { path: 'request.messages[1].content', kind: 'changed', a: 'a beach trip', b: 'a city break' },
    ]);
  });

  it('works through the CLI with --llm-host', async () => {
    const out = join(dir, 'cli.tape.json');
    let stderr = '';
    const io: CliIO = { stdout: () => {}, stderr: (t) => (stderr += t), color: false };
    expect(await main(['record', '-o', out, '--llm-host', host, '--', 'node', fixture, baseURL, 'a hike'], io)).toBe(0);
    expect(stderr).toContain('Recorded 3 events');

    let stdout = '';
    const io2: CliIO = { stdout: (t) => (stdout += t), stderr: () => {}, color: false };
    expect(await main(['replay', out, '--against', agent('a hike')], io2)).toBe(0);
    expect(stdout).toContain('Tapes match: all 3 steps are identical.');
  });

  it('records nothing for hosts it was not told about', async () => {
    const run = await recordCommand(agent('a road trip'), { output: join(dir, 'unknown.tape.json'), stdio: 'pipe' });
    expect(run.tape.events.filter((e): e is LlmCallEvent => e.type === 'llm_call')).toEqual([]);
  });
});
