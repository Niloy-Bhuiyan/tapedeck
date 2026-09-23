import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli/main.js';
import { renderDiffReport, renderTapeReport } from '../src/report/html.js';
import { TapeRecorder } from '../src/tape/recorder.js';
import type { Tape } from '../src/tape/schema.js';

function tape(query: string, name = 'report demo'): Tape {
  const rec = new TapeRecorder(() => 0);
  rec.append({ type: 'clock_read', source: 'Date.now', value: 0 });
  const call = rec.append({ type: 'tool_call', tool: 'search', callId: '', args: { query } });
  rec.append({ type: 'tool_result', tool: 'search', callId: call.id, result: ['</script><script>alert(1)</script>'], durationMs: 3 });
  return rec.toTape({ name, outcome: { status: 'ok', value: query } });
}

/** Pulls the embedded report data back out of the page. */
function embedded(html: string): any {
  const match = html.match(/<script type="application\/json" id="tapedeck-data">([\s\S]*?)<\/script>/);
  return JSON.parse(match![1]!);
}

describe('HTML report', () => {
  it('is a single self-contained page', () => {
    const html = renderTapeReport(tape('x'));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|@import|https?:\/\//);
  });

  it('embeds the tape timeline with event summaries', () => {
    const data = embedded(renderTapeReport(tape('cassettes')));
    expect(data.kind).toBe('tape');
    expect(data.tape).toMatchObject({ name: 'report demo', eventCount: 3, outcome: 'ok' });
    expect(data.events.map((e: any) => e.type)).toEqual(['clock_read', 'tool_call', 'tool_result']);
    expect(data.events[1].summary).toBe('search({"query":"cassettes"})');
    expect(data.events[2].durationMs).toBe(3);
  });

  it('cannot be broken out of by recorded content', () => {
    const html = renderTapeReport(tape('x', '<b>name</b>'));
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('<title>&lt;b&gt;name&lt;/b&gt; · TapeDeck</title>');
    expect(embedded(html).events[2].detail.result[0]).toBe('</script><script>alert(1)</script>');
  });

  it('embeds a diff with the first divergence and field changes', () => {
    const data = embedded(renderDiffReport(tape('a'), tape('b')));
    expect(data.kind).toBe('diff');
    expect(data.equal).toBe(false);
    expect(data.firstDivergence).toBe(1);
    expect(data.steps[1]).toMatchObject({ status: 'changed', changes: ['args.query: "a" → "b"'] });
    expect(data.outcome).toEqual({ status: 'changed', changes: ['value: "a" → "b"'] });
    expect(data.summary).toContain('Tapes diverge at step 2 of 3.');
  });

  it('is written by `tapedeck report`', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tapedeck-report-'));
    const a = join(dir, 'a.tape.json');
    const b = join(dir, 'b.tape.json');
    const { writeTapeFile } = await import('../src/tape/io.js');
    writeTapeFile(a, tape('a'));
    writeTapeFile(b, tape('b'));
    const io = { stdout: () => {}, stderr: () => {}, color: false };

    const single = join(dir, 'out', 'tape.html');
    expect(await main(['report', a, '-o', single], io)).toBe(0);
    expect(embedded(readFileSync(single, 'utf8')).kind).toBe('tape');

    const diff = join(dir, 'diff.html');
    expect(await main(['report', a, '--diff', b, '-o', diff], io)).toBe(0);
    expect(embedded(readFileSync(diff, 'utf8')).kind).toBe('diff');

    expect(await main(['report'], io)).toBe(2);
  });
});
