import type { Json } from '../tape/schema.js';

/** One leaf-level difference between two JSON values. */
export interface FieldChange {
  /** Path from the compared root, e.g. `request.messages[2].content`. Empty for the root itself. */
  path: string;
  kind: 'changed' | 'added' | 'removed';
  /** Value on the left side (absent for `added`). */
  a?: Json;
  /** Value on the right side (absent for `removed`). */
  b?: Json;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function joinPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  if (IDENTIFIER.test(key)) return base ? `${base}.${key}` : key;
  return `${base}[${JSON.stringify(key)}]`;
}

const isObject = (v: Json | undefined): v is { [key: string]: Json } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Lists the leaf differences between `a` and `b`. Arrays are compared by
 * index; objects by key (key order is irrelevant). Returns `[]` when equal.
 */
export function deepDiff(a: Json | undefined, b: Json | undefined, path = ''): FieldChange[] {
  if (a === undefined && b === undefined) return [];
  if (a === undefined) return [{ path, kind: 'added', b: b as Json }];
  if (b === undefined) return [{ path, kind: 'removed', a }];

  if (Array.isArray(a) && Array.isArray(b)) {
    const changes: FieldChange[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      changes.push(...deepDiff(a[i], b[i], joinPath(path, i)));
    }
    return changes;
  }
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((key) => deepDiff(a[key], b[key], joinPath(path, key)));
  }
  return Object.is(a, b) ? [] : [{ path, kind: 'changed', a, b }];
}

/** Compact one-line rendering of a JSON value for messages. */
export function preview(value: Json | undefined, max = 60): string {
  if (value === undefined) return '(absent)';
  const text = JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Human-readable one-liner for a change, e.g. `args.q: "a" → "b"`. */
export function describeChange(change: FieldChange): string {
  const where = change.path || '(value)';
  switch (change.kind) {
    case 'added':
      return `${where}: added ${preview(change.b)}`;
    case 'removed':
      return `${where}: removed ${preview(change.a)}`;
    case 'changed':
      return `${where}: ${preview(change.a)} → ${preview(change.b)}`;
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds a predicate for ignore patterns over change paths. Patterns use the
 * same syntax as the paths themselves, plus wildcards: `*` matches one key,
 * `[*]` any array index, `**` any depth. A pattern also covers everything
 * below it: `request.metadata` ignores `request.metadata.trace_id`.
 *
 * @example pathMatcher(['request.messages[*].name', '**.trace_id'])
 */
export function pathMatcher(patterns: readonly string[]): (path: string) => boolean {
  const regexes = patterns.map((pattern) => {
    const body = pattern
      .split(/(\*\*|\[\*\]|\*)/)
      .map((part) => {
        if (part === '**') return '.*';
        if (part === '[*]') return '\\[\\d+\\]';
        if (part === '*') return '[^.[]+';
        return escapeRegExp(part);
      })
      .join('');
    return new RegExp(`^${body}(?:$|[.[])`);
  });
  return (path) => regexes.some((regex) => regex.test(path));
}
