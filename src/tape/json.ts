import { createHash } from 'node:crypto';
import type { Json, SerializedError } from './schema.js';

/**
 * Converts an arbitrary value to plain JSON data, the same way
 * JSON.stringify would (dropping functions/undefined, calling toJSON).
 * SDK responses are class instances; this turns them into data we can
 * store, compare and hand back on replay.
 */
export function toJson(value: unknown): Json {
  if (value === undefined) return null;
  const text = JSON.stringify(value);
  return text === undefined ? null : (JSON.parse(text) as Json);
}

/** JSON.stringify with object keys sorted, so equal data gives equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(toJson(value)));
}

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key] as Json);
    return out;
  }
  return value;
}

/** Deep equality on JSON data, insensitive to object key order. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Short, stable content hash (first 8 hex chars of SHA-256). */
export function shortHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 8);
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const out: SerializedError = { name: error.name, message: error.message };
    const extra = error as Error & { status?: unknown; code?: unknown };
    if (typeof extra.status === 'number') out.status = extra.status;
    if (typeof extra.code === 'string') out.code = extra.code;
    return out;
  }
  return { name: 'NonErrorThrown', message: String(error) };
}

/** Rebuilds a throwable Error from its recorded form. */
export function deserializeError(recorded: SerializedError): Error {
  const error = new Error(recorded.message) as Error & { status?: number; code?: string };
  error.name = recorded.name;
  if (recorded.status !== undefined) error.status = recorded.status;
  if (recorded.code !== undefined) error.code = recorded.code;
  return error;
}
