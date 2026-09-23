/** True when an SDK request asks for a streamed response (`stream: true`). */
export function isStreamRequest(request: unknown): boolean {
  return typeof request === 'object' && request !== null && (request as { stream?: unknown }).stream === true;
}

/** Drains an SDK stream into an array of chunks. */
export async function collectStream(stream: unknown): Promise<unknown[]> {
  if (stream === null || typeof stream !== 'object' || !(Symbol.asyncIterator in stream)) {
    throw new TypeError('Expected a streamed SDK response to be async iterable');
  }
  const chunks: unknown[] = [];
  for await (const chunk of stream as AsyncIterable<unknown>) chunks.push(chunk);
  return chunks;
}

/**
 * Re-emits recorded chunks as an async iterable, which is how SDK streams
 * are consumed (`for await (const chunk of stream)`).
 */
export async function* streamOf<T>(chunks: readonly T[]): AsyncGenerator<T> {
  for (const chunk of chunks) yield chunk;
}
