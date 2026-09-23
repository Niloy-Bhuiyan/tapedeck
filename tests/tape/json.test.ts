import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  deserializeError,
  jsonEqual,
  serializeError,
  shortHash,
  toJson,
} from '../../src/tape/json.js';

describe('toJson', () => {
  it('strips functions and undefined like JSON.stringify', () => {
    expect(toJson({ a: 1, b: undefined, c: () => 1, d: [undefined] })).toEqual({ a: 1, d: [null] });
  });

  it('maps a bare undefined to null', () => {
    expect(toJson(undefined)).toBeNull();
  });

  it('flattens class instances to their data', () => {
    class Box {
      constructor(public value: number) {}
    }
    expect(toJson(new Box(3))).toEqual({ value: 3 });
  });
});

describe('canonicalJson', () => {
  it('is independent of key order at every depth', () => {
    const a = { z: 1, a: { y: [1, { q: 1, b: 2 }], x: null } };
    const b = { a: { x: null, y: [1, { b: 2, q: 1 }] }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(jsonEqual(a, b)).toBe(true);
  });

  it('keeps array order significant', () => {
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });
});

describe('shortHash', () => {
  it('is stable and 8 hex characters long', () => {
    expect(shortHash({ b: 1, a: 2 })).toBe(shortHash({ a: 2, b: 1 }));
    expect(shortHash('x')).toMatch(/^[0-9a-f]{8}$/);
    expect(shortHash('x')).not.toBe(shortHash('y'));
  });
});

describe('error serialization', () => {
  it('round-trips name, message, status and code', () => {
    const original = Object.assign(new Error('slow down'), {
      name: 'RateLimitError',
      status: 429,
      code: 'rate_limit_exceeded',
    });
    const recorded = serializeError(original);
    expect(recorded).toEqual({
      name: 'RateLimitError',
      message: 'slow down',
      status: 429,
      code: 'rate_limit_exceeded',
    });
    const rebuilt = deserializeError(recorded) as Error & { status?: number; code?: string };
    expect(rebuilt).toBeInstanceOf(Error);
    expect(rebuilt.name).toBe('RateLimitError');
    expect(rebuilt.status).toBe(429);
    expect(rebuilt.code).toBe('rate_limit_exceeded');
  });

  it('handles non-Error throws', () => {
    expect(serializeError('boom')).toEqual({ name: 'NonErrorThrown', message: 'boom' });
  });
});
