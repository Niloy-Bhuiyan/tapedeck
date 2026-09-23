import { describeChange, preview } from '../diff/deep.js';
import type { DiffStep, TapeDiff } from '../diff/diff.js';
import type { Tape, TapeEvent } from '../tape/schema.js';
import { palette, type Palette } from './colors.js';
import { summarizeEvent } from './summarize.js';

export interface FormatOptions {
  color?: boolean;
}

const TYPE_WIDTH = 'tool_result'.length;

function eventLine(event: TapeEvent, c: Palette): string {
  const type = event.type.padEnd(TYPE_WIDTH);
  const colored =
    event.type === 'llm_call' ? c.cyan(type) : event.type.startsWith('tool') ? c.yellow(type) : c.dim(type);
  const duration = 'durationMs' in event && event.durationMs > 0 ? c.dim(`  ${event.durationMs}ms`) : '';
  return `${colored}  ${summarizeEvent(event)}${duration}`;
}

/** Renders a tape as a step-by-step timeline. */
export function formatTimeline(tape: Tape, options: FormatOptions = {}): string {
  const c = palette(options.color ?? false);
  const lines = [
    `${c.bold('Tape')} ${tape.name ?? '(unnamed)'} ${c.dim(tape.id)}`,
    c.dim(
      [`recorded ${tape.createdAt}`, `${tape.events.length} events`, tape.metadata.command && `command: ${tape.metadata.command}`]
        .filter(Boolean)
        .join(' · '),
    ),
    '',
  ];
  const seqWidth = String(Math.max(tape.events.length - 1, 0)).length;
  for (const event of tape.events) {
    const time = `+${event.t}ms`.padStart(9);
    lines.push(`  ${c.dim(`#${String(event.seq).padStart(seqWidth)}`)} ${c.dim(time)}  ${eventLine(event, c)}`);
  }
  if (tape.events.length === 0) lines.push(c.dim('  (no events)'));
  lines.push('');
  const { outcome } = tape;
  if (!outcome) lines.push(`Outcome: ${c.dim('unknown (the run did not finish cleanly)')}`);
  else if (outcome.status === 'ok') {
    const detail = outcome.exitCode !== undefined ? `exit code ${outcome.exitCode}` : preview(outcome.value, 100);
    lines.push(`Outcome: ${c.green('ok')} ${detail}`);
  } else {
    const detail = outcome.error ? `${outcome.error.name}: ${outcome.error.message}` : `exit code ${outcome.exitCode}`;
    lines.push(`Outcome: ${c.red('error')} ${detail}`);
  }
  return lines.join('\n');
}

const MARKS = { match: '✓', changed: '~', added: '+', removed: '-' } as const;

function stepLines(step: DiffStep, c: Palette, width: number): string[] {
  const event = (step.b ?? step.a)!;
  const paint = { match: c.green, changed: c.yellow, added: c.green, removed: c.red }[step.status];
  const mark = paint(MARKS[step.status]);
  const num = c.dim(String(step.index + 1).padStart(width));
  const head = `  ${mark} ${num}  ${eventLine(step.status === 'removed' ? step.a! : event, c)}`;
  const body = step.changes.slice(0, 8).map((change) => `  ${' '.repeat(width + 4)}${c.dim('│')} ${describeChange(change)}`);
  if (step.changes.length > 8) body.push(`  ${' '.repeat(width + 4)}${c.dim(`│ …and ${step.changes.length - 8} more`)}`);
  return [head, ...body];
}

/**
 * Renders a diff: every non-matching step with its field changes, a little
 * matching context around each, and the summary.
 */
export function formatDiff(diff: TapeDiff, options: FormatOptions & { context?: number } = {}): string {
  const c = palette(options.color ?? false);
  const context = options.context ?? 2;
  const width = String(diff.steps.length).length;
  const interesting = diff.steps.map((s) => s.status !== 'match');
  const near = (i: number) => interesting.slice(Math.max(0, i - context), i + context + 1).some(Boolean);

  const lines: string[] = [];
  let hidden = 0;
  const flushHidden = () => {
    if (hidden > 0) lines.push(c.dim(`  ${' '.repeat(width + 2)}… ${hidden} matching step${hidden === 1 ? '' : 's'}`));
    hidden = 0;
  };
  for (const step of diff.steps) {
    if (!interesting[step.index] && !near(step.index)) {
      hidden++;
      continue;
    }
    flushHidden();
    lines.push(...stepLines(step, c, width));
  }
  flushHidden();

  const outcome = diff.outcome.status === 'match' ? c.green('match') : c.red('changed');
  lines.push('', `Outcome: ${outcome}`);
  for (const change of diff.outcome.changes.slice(0, 8)) lines.push(`  ${c.dim('│')} ${describeChange(change)}`);
  lines.push('', diff.equal ? c.green(diff.summary) : c.bold(diff.summary));
  return lines.join('\n');
}
