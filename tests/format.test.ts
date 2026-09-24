import { describe, expect, it } from 'vitest';
import { diffTapes } from '../src/diff/diff.js';
import { colorEnabled, palette } from '../src/format/colors.js';
import { summarizeEvent } from '../src/format/summarize.js';
import { formatDiff, formatTimeline } from '../src/format/text.js';
import { TapeRecorder } from '../src/tape/recorder.js';
import type { Tape } from '../src/tape/schema.js';

function sample(query = 'tapes', extraRandoms = 0): Tape {
  const rec = new TapeRecorder(() => 0);
  rec.append({ type: 'clock_read', source: 'Date.now', value: Date.UTC(2026, 8, 23) });
  for (let i = 0; i < extraRandoms; i++) rec.append({ type: 'random_draw', value: 0.5 });
  rec.append({
    type: 'llm_call',
    provider: 'openai',
    operation: 'chat.completions.create',
    request: { model: 'gpt-x', messages: [] },
    response: { choices: [{ message: { content: null, tool_calls: [{ function: { name: 'search' } }] } }] },
    durationMs: 120,
  });
  const call = rec.append({ type: 'tool_call', tool: 'search', callId: '', args: { query } });
  rec.append({ type: 'tool_result', tool: 'search', callId: call.id, result: ['hit'], durationMs: 2 });
  return rec.toTape({ name: 'sample', outcome: { status: 'ok', value: 'fine' } });
}

describe('summarizeEvent', () => {
  it('describes OpenAI tool-calling responses', () => {
    expect(summarizeEvent(sample().events[1]!)).toBe('openai chat.completions.create model=gpt-x → tool calls: search');
  });

  it('describes Anthropic text responses', () => {
    const rec = new TapeRecorder(() => 0);
    const ev = rec.append({
      type: 'llm_call',
      provider: 'anthropic',
      operation: 'messages.create',
      request: { model: 'claude-x' },
      response: { content: [{ type: 'text', text: 'Hi there' }] },
      durationMs: 1,
    });
    expect(summarizeEvent(ev)).toBe('anthropic messages.create model=claude-x → "Hi there"');
  });

  it('reassembles streamed text and tool calls', () => {
    const rec = new TapeRecorder(() => 0);
    const base = { type: 'llm_call', provider: 'openai', operation: 'op', request: {}, stream: true, durationMs: 1 } as const;
    const openaiText = rec.append({
      ...base,
      response: [{ data: { choices: [{ delta: { content: 'Hel' } }] } }, { data: { choices: [{ delta: { content: 'lo' } }] } }, { data: '[DONE]' }],
    });
    expect(summarizeEvent(openaiText)).toBe('openai op → "Hello" (streamed)');
    const anthropicTool = rec.append({
      ...base,
      provider: 'anthropic',
      response: [{ event: 'content_block_start', data: { content_block: { type: 'tool_use', name: 'search' } } }],
    });
    expect(summarizeEvent(anthropicTool)).toBe('anthropic op → tool calls: search (streamed)');
    expect(summarizeEvent(rec.append({ ...base, response: [{ data: 'ping' }] }))).toBe('openai op → 1 streamed chunks');
  });

  it('describes errors, clocks and draws', () => {
    const rec = new TapeRecorder(() => 0);
    const failed = rec.append({
      type: 'tool_result',
      tool: 'calc',
      callId: 'x',
      error: { name: 'RangeError', message: 'too big' },
      durationMs: 0,
    });
    expect(summarizeEvent(failed)).toBe('calc ✗ RangeError: too big');
    expect(summarizeEvent(rec.append({ type: 'clock_read', source: 'new Date', value: 0 }))).toBe(
      'new Date → 1970-01-01T00:00:00.000Z',
    );
    expect(summarizeEvent(rec.append({ type: 'random_draw', value: 0.25 }))).toBe('Math.random → 0.25');
  });
});

describe('formatTimeline', () => {
  it('lists every event with its sequence number and the outcome', () => {
    const text = formatTimeline(sample());
    expect(text).toContain('Tape sample');
    expect(text).toContain('4 events');
    expect(text).toMatch(/#0 .*clock_read .*Date\.now → 2026-09-23T00:00:00\.000Z/);
    expect(text).toMatch(/#2 .*tool_call .*search\(\{"query":"tapes"\}\)/);
    expect(text).toContain('Outcome: ok "fine"');
    expect(text).not.toContain('\u001b[');
  });

  it('adds ANSI colors on request', () => {
    expect(formatTimeline(sample(), { color: true })).toContain('\u001b[');
  });
});

describe('formatDiff', () => {
  it('shows changed steps with their field changes and the summary', () => {
    const text = formatDiff(diffTapes(sample(), sample('records')));
    expect(text).toMatch(/~ 3 {2}tool_call +search/);
    expect(text).toContain('│ args.query: "tapes" → "records"');
    expect(text).toContain('Tapes diverge at step 3 of 4.');
  });

  it('collapses long runs of matching steps', () => {
    const text = formatDiff(diffTapes(sample('a', 20), sample('b', 20)), { context: 1 });
    expect(text).toMatch(/… \d+ matching steps/);
  });

  it('prints a short confirmation for equal tapes', () => {
    const text = formatDiff(diffTapes(sample(), sample()));
    expect(text).toContain('Tapes match: all 4 steps are identical.');
  });
});

describe('colors', () => {
  it('is a no-op palette when disabled', () => {
    expect(palette(false).red('x')).toBe('x');
    expect(palette(true).red('x')).toBe('\u001b[31mx\u001b[39m');
  });

  it('respects NO_COLOR and FORCE_COLOR', () => {
    const saved = { ...process.env };
    try {
      process.env.NO_COLOR = '1';
      expect(colorEnabled({ isTTY: true })).toBe(false);
      delete process.env.NO_COLOR;
      process.env.FORCE_COLOR = '1';
      expect(colorEnabled({ isTTY: false })).toBe(true);
      delete process.env.FORCE_COLOR;
      expect(colorEnabled({ isTTY: true })).toBe(true);
    } finally {
      process.env = saved;
    }
  });
});
