import type { EventType, Json, Tape, TapeEvent, TapeOutcome } from '../tape/schema.js';
import { toJson } from '../tape/json.js';
import { deepDiff, describeChange, type FieldChange } from './deep.js';

export type StepStatus = 'match' | 'changed' | 'added' | 'removed';

/** One aligned position in the comparison of tape A (baseline) and tape B. */
export interface DiffStep {
  /** Zero-based position in `steps`. */
  index: number;
  status: StepStatus;
  /** Alignment key, e.g. `tool_call:search` or `llm_call:openai:chat.completions.create`. */
  key: string;
  /** Event from tape A (absent when `added`). */
  a?: TapeEvent;
  /** Event from tape B (absent when `removed`). */
  b?: TapeEvent;
  /** Field-level differences for `changed` steps; empty otherwise. */
  changes: FieldChange[];
}

export interface OutcomeDiff {
  status: 'match' | 'changed';
  changes: FieldChange[];
}

export interface TapeDiff {
  /** True when every step matches and the outcomes match. */
  equal: boolean;
  steps: DiffStep[];
  outcome: OutcomeDiff;
  /** The first step that is not a match; `null` if all steps match. */
  firstDivergence: DiffStep | null;
  stats: { matched: number; changed: number; added: number; removed: number };
  /** Human-readable explanation of where and how the tapes diverge. */
  summary: string;
}

export interface DiffOptions {
  /** Event types to leave out of the comparison entirely, e.g. `['clock_read']`. */
  ignoreTypes?: EventType[];
  /** Skip comparing how the two runs ended. */
  ignoreOutcome?: boolean;
}

export function alignmentKey(event: TapeEvent): string {
  switch (event.type) {
    case 'llm_call':
      return `llm_call:${event.provider}:${event.operation}`;
    case 'tool_call':
    case 'tool_result':
      return `${event.type}:${event.tool}`;
    case 'clock_read':
    case 'random_draw':
      return event.type;
  }
}

/**
 * The behaviour-relevant part of an event. IDs, positions, timings and
 * correlation IDs are excluded: they differ between runs without the
 * behaviour differing.
 */
function payload(event: TapeEvent): Json {
  switch (event.type) {
    case 'llm_call':
      return toJson({
        request: event.request,
        response: event.response,
        stream: event.stream,
        error: event.error,
      });
    case 'tool_call':
      return toJson({ args: event.args });
    case 'tool_result':
      return toJson({ result: event.result, error: event.error });
    case 'clock_read':
    case 'random_draw':
      return { value: event.value };
  }
}

type Pair = [a: TapeEvent | undefined, b: TapeEvent | undefined];

/**
 * Aligns two event lists by key using a longest-common-subsequence match,
 * after trimming the shared prefix and suffix (which keeps the quadratic
 * part small for the usual case of two mostly-identical runs).
 */
function align(a: TapeEvent[], b: TapeEvent[]): Pair[] {
  const ka = a.map(alignmentKey);
  const kb = b.map(alignmentKey);
  let start = 0;
  while (start < a.length && start < b.length && ka[start] === kb[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && ka[endA - 1] === kb[endB - 1]) {
    endA--;
    endB--;
  }

  const n = endA - start;
  const m = endB - start;
  // lcs[i][j] = LCS length of a[start+i..endA) and b[start+j..endB), row-major.
  const lcs = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[at(i, j)] =
        ka[start + i] === kb[start + j]
          ? lcs[at(i + 1, j + 1)]! + 1
          : Math.max(lcs[at(i + 1, j)]!, lcs[at(i, j + 1)]!);
    }
  }

  const pairs: Pair[] = [];
  for (let i = 0; i < start; i++) pairs.push([a[i], b[i]]);
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ka[start + i] === kb[start + j]) {
      pairs.push([a[start + i], b[start + j]]);
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[at(i + 1, j)]! >= lcs[at(i, j + 1)]!)) {
      pairs.push([a[start + i], undefined]);
      i++;
    } else {
      pairs.push([undefined, b[start + j]]);
      j++;
    }
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([a[endA + k], b[endB + k]]);
  return pairs;
}

function outcomePayload(outcome: TapeOutcome | undefined): Json | undefined {
  return outcome === undefined ? undefined : toJson(outcome);
}

/** Compares tape `a` (the baseline) with tape `b` (e.g. a fresh replay run). */
export function diffTapes(a: Tape, b: Tape, options: DiffOptions = {}): TapeDiff {
  const ignored = new Set(options.ignoreTypes ?? []);
  const keep = (e: TapeEvent) => !ignored.has(e.type);

  const steps: DiffStep[] = align(a.events.filter(keep), b.events.filter(keep)).map(([ea, eb], index) => {
    const key = alignmentKey((ea ?? eb)!);
    if (!ea) return { index, status: 'added', key, b: eb, changes: [] };
    if (!eb) return { index, status: 'removed', key, a: ea, changes: [] };
    const changes = deepDiff(payload(ea), payload(eb));
    return { index, status: changes.length ? 'changed' : 'match', key, a: ea, b: eb, changes };
  });

  const outcomeChanges = options.ignoreOutcome ? [] : deepDiff(outcomePayload(a.outcome), outcomePayload(b.outcome));
  const outcome: OutcomeDiff = { status: outcomeChanges.length ? 'changed' : 'match', changes: outcomeChanges };

  const count = (status: StepStatus) => steps.filter((s) => s.status === status).length;
  const stats = { matched: count('match'), changed: count('changed'), added: count('added'), removed: count('removed') };
  const firstDivergence = steps.find((s) => s.status !== 'match') ?? null;
  const equal = firstDivergence === null && outcome.status === 'match';

  const diff: TapeDiff = { equal, steps, outcome, firstDivergence, stats, summary: '' };
  diff.summary = summarizeDiff(diff);
  return diff;
}

export function describeEvent(event: TapeEvent): string {
  switch (event.type) {
    case 'llm_call':
      return `LLM call (${event.provider} ${event.operation})`;
    case 'tool_call':
      return `tool call "${event.tool}"`;
    case 'tool_result':
      return `tool result "${event.tool}"`;
    case 'clock_read':
      return 'clock read';
    case 'random_draw':
      return 'random draw';
  }
}

function whatChanged(step: DiffStep): string {
  const touched = (prefix: string) => step.changes.some((c) => c.path === prefix || c.path.startsWith(`${prefix}.`) || c.path.startsWith(`${prefix}[`));
  switch (step.a!.type) {
    case 'llm_call':
      if (touched('request')) return 'was sent a different request';
      if (touched('error')) return 'failed differently';
      return 'returned a different response';
    case 'tool_call':
      return 'was called with different arguments';
    case 'tool_result':
      return touched('error') ? 'failed differently' : 'returned a different result';
    case 'clock_read':
      return 'read a different time';
    case 'random_draw':
      return 'drew a different number';
  }
}

const MAX_LISTED_CHANGES = 5;

/** Explains a single non-matching step in one or more lines. */
export function describeStep(step: DiffStep): string {
  const where = `Step ${step.index + 1}`;
  switch (step.status) {
    case 'match':
      return `${where}: ${describeEvent(step.a!)} matches`;
    case 'added':
      return `${where}: the new run made an extra ${describeEvent(step.b!)} that is not in the baseline`;
    case 'removed':
      return `${where}: the baseline's ${describeEvent(step.a!)} is missing from the new run`;
    case 'changed': {
      const lines = step.changes.slice(0, MAX_LISTED_CHANGES).map((c) => `  - ${describeChange(c)}`);
      if (step.changes.length > MAX_LISTED_CHANGES) lines.push(`  - …and ${step.changes.length - MAX_LISTED_CHANGES} more`);
      return [`${where}: ${describeEvent(step.a!)} ${whatChanged(step)}:`, ...lines].join('\n');
    }
  }
}

function summarizeDiff(diff: TapeDiff): string {
  const total = diff.steps.length;
  const { matched, changed, added, removed } = diff.stats;
  if (diff.equal) return `Tapes match: all ${total} steps are identical.`;

  const lines: string[] = [];
  if (diff.firstDivergence) {
    lines.push(`Tapes diverge at step ${diff.firstDivergence.index + 1} of ${total}.`, describeStep(diff.firstDivergence));
  } else {
    lines.push(`All ${total} steps match, but the runs ended differently.`);
  }
  lines.push(`${matched} matched, ${changed} changed, ${added} added, ${removed} removed.`);
  if (diff.outcome.status === 'changed') {
    lines.push('Outcome differs:', ...diff.outcome.changes.slice(0, MAX_LISTED_CHANGES).map((c) => `  - ${describeChange(c)}`));
  }
  return lines.join('\n');
}
