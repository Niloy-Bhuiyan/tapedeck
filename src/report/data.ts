import { describeChange } from '../diff/deep.js';
import type { TapeDiff } from '../diff/diff.js';
import { summarizeEvent } from '../format/summarize.js';
import type { EventType, Json, Tape, TapeEvent } from '../tape/schema.js';

/** Plain-data view models embedded in the HTML report. */
export interface TapeView {
  name: string;
  id: string;
  createdAt: string;
  command: string | null;
  eventCount: number;
  outcome: string;
  outcomeStatus: 'ok' | 'error' | 'unknown';
}

export interface EventView {
  seq: number;
  t: number;
  type: EventType;
  id: string;
  summary: string;
  durationMs: number | null;
  /** The event's content, minus the fields shown elsewhere. */
  detail: Json;
}

export interface StepView {
  index: number;
  status: 'match' | 'changed' | 'added' | 'removed';
  key: string;
  a: EventView | null;
  b: EventView | null;
  changes: string[];
}

export type ReportData =
  | { kind: 'tape'; tape: TapeView; events: EventView[] }
  | {
      kind: 'diff';
      a: TapeView;
      b: TapeView;
      equal: boolean;
      summary: string;
      stats: TapeDiff['stats'];
      outcome: { status: 'match' | 'changed'; changes: string[] };
      firstDivergence: number | null;
      steps: StepView[];
    };

function tapeView(tape: Tape): TapeView {
  const o = tape.outcome;
  let outcome = 'unknown (the run did not finish cleanly)';
  if (o?.status === 'ok') outcome = o.exitCode !== undefined ? `ok · exit code ${o.exitCode}` : 'ok';
  if (o?.status === 'error') outcome = o.error ? `error · ${o.error.name}: ${o.error.message}` : `error · exit code ${o.exitCode}`;
  return {
    name: tape.name ?? '(unnamed tape)',
    id: tape.id,
    createdAt: tape.createdAt,
    command: tape.metadata.command ?? null,
    eventCount: tape.events.length,
    outcome,
    outcomeStatus: o?.status ?? 'unknown',
  };
}

function eventView(event: TapeEvent): EventView {
  const { id, seq, t, type, ...rest } = event;
  const durationMs = 'durationMs' in event ? event.durationMs : null;
  delete (rest as { durationMs?: number }).durationMs;
  return { seq, t, type, id, summary: summarizeEvent(event), durationMs, detail: rest as unknown as Json };
}

export function tapeReportData(tape: Tape): ReportData {
  return { kind: 'tape', tape: tapeView(tape), events: tape.events.map(eventView) };
}

export function diffReportData(a: Tape, b: Tape, diff: TapeDiff): ReportData {
  return {
    kind: 'diff',
    a: tapeView(a),
    b: tapeView(b),
    equal: diff.equal,
    summary: diff.summary,
    stats: diff.stats,
    outcome: { status: diff.outcome.status, changes: diff.outcome.changes.map(describeChange) },
    firstDivergence: diff.firstDivergence?.index ?? null,
    steps: diff.steps.map((s) => ({
      index: s.index,
      status: s.status,
      key: s.key,
      a: s.a ? eventView(s.a) : null,
      b: s.b ? eventView(s.b) : null,
      changes: s.changes.map(describeChange),
    })),
  };
}
