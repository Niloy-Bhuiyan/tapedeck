import type { Json } from './schema.js';

export const REDACTED = '[REDACTED]';

/**
 * Well-known credential formats, scrubbed from every tape by default.
 * Extra patterns can be added per recording (`redact` option / `--redact`).
 */
export const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = [
  /sk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g, // OpenAI / Anthropic API keys
  /AIza[0-9A-Za-z_-]{35}/g, // Google API keys
  /AKIA[0-9A-Z]{16}/g, // AWS access key IDs
  /gh[pousr]_[A-Za-z0-9]{36,}/g, // GitHub tokens
  /xox[abposr]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /Bearer\s+[A-Za-z0-9._~+/-]{20,}=*/g, // bearer tokens
];

/** Compiles user-supplied pattern sources (as stored in tape metadata) into global regexes. */
export function compilePatterns(sources: readonly string[]): RegExp[] {
  return sources.map((source) => new RegExp(source, 'g'));
}

/** Replaces every match of `patterns` in every string inside `value`. */
export function redactJson<T extends Json | undefined>(value: T, patterns: readonly RegExp[]): T {
  if (typeof value === 'string') {
    return patterns.reduce<string>((text, pattern) => text.replace(pattern, REDACTED), value) as T;
  }
  if (Array.isArray(value)) return value.map((item) => redactJson(item, patterns)) as T;
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) out[key] = redactJson(item, patterns);
    return out as T;
  }
  return value;
}
