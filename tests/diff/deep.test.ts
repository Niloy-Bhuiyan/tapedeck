import { describe, expect, it } from 'vitest';
import { deepDiff, describeChange, joinPath, preview } from '../../src/diff/deep.js';

describe('deepDiff', () => {
  it('returns nothing for equal values regardless of key order', () => {
    expect(deepDiff({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toEqual([]);
  });

  it('reports leaf changes with paths', () => {
    const a = { messages: [{ role: 'user', content: 'hi' }], temperature: 0 };
    const b = { messages: [{ role: 'user', content: 'hello' }], temperature: 0.7 };
    expect(deepDiff(a, b)).toEqual([
      { path: 'messages[0].content', kind: 'changed', a: 'hi', b: 'hello' },
      { path: 'temperature', kind: 'changed', a: 0, b: 0.7 },
    ]);
  });

  it('reports added and removed keys and array items', () => {
    expect(deepDiff({ x: 1, list: [1] }, { list: [1, 2], y: 2 })).toEqual([
      { path: 'list[1]', kind: 'added', b: 2 },
      { path: 'x', kind: 'removed', a: 1 },
      { path: 'y', kind: 'added', b: 2 },
    ]);
  });

  it('treats a type change as a single change at that path', () => {
    expect(deepDiff({ v: [1] }, { v: { 0: 1 } })).toEqual([{ path: 'v', kind: 'changed', a: [1], b: { 0: 1 } }]);
  });

  it('handles root-level primitives and absent sides', () => {
    expect(deepDiff(1, 2)).toEqual([{ path: '', kind: 'changed', a: 1, b: 2 }]);
    expect(deepDiff(undefined, 'x')).toEqual([{ path: '', kind: 'added', b: 'x' }]);
    expect(deepDiff(null, undefined)).toEqual([{ path: '', kind: 'removed', a: null }]);
  });
});

describe('path and message helpers', () => {
  it('quotes non-identifier keys', () => {
    expect(joinPath('', 'plain')).toBe('plain');
    expect(joinPath('headers', 'x-api-key')).toBe('headers["x-api-key"]');
    expect(joinPath('list', 3)).toBe('list[3]');
  });

  it('truncates long previews', () => {
    expect(preview('x'.repeat(100), 10)).toHaveLength(10);
    expect(preview(undefined)).toBe('(absent)');
  });

  it('describes each change kind', () => {
    expect(describeChange({ path: 'q', kind: 'changed', a: 'a', b: 'b' })).toBe('q: "a" → "b"');
    expect(describeChange({ path: '', kind: 'added', b: 1 })).toBe('(value): added 1');
    expect(describeChange({ path: 'k', kind: 'removed', a: null })).toBe('k: removed null');
  });
});
