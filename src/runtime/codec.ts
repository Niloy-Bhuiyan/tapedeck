import { toJson } from '../tape/json.js';
import type { HttpMeta, Json } from '../tape/schema.js';
import { collectStream, isStreamRequest, streamOf } from './stream.js';

/** The recordable form of an LLM response. */
export interface CapturedResponse {
  response: Json;
  stream?: boolean;
  http?: HttpMeta;
}

/**
 * Converts between what an intercepted LLM call returns live and what is
 * stored on the tape. SDK-level wrappers store the parsed response object;
 * the fetch interceptor stores an HTTP body and rebuilds a `Response`.
 */
export interface LlmCodec {
  /** Turns a live result into tape data plus the value to hand back to the caller. */
  capture(live: unknown, request: unknown): Promise<{ value: unknown; captured: CapturedResponse }>;
  /** Rebuilds the caller-facing value from tape data. */
  revive(captured: CapturedResponse): unknown;
}

/** Converts between a tool's live return value and its recorded `result`. */
export interface ToolCodec {
  capture(live: unknown): Promise<{ value: unknown; result: Json }>;
  revive(result: Json): unknown;
}

const clone = <T extends Json>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** For SDK methods: stores the response object, or the chunks of a stream. */
export const sdkCodec: LlmCodec = {
  async capture(live, request) {
    if (!isStreamRequest(request)) return { value: live, captured: { response: toJson(live) } };
    // Streams are buffered so the chunks can be recorded, then re-emitted.
    const chunks = await collectStream(live);
    return { value: streamOf(chunks), captured: { response: toJson(chunks), stream: true } };
  },
  revive(captured) {
    return captured.stream ? streamOf(clone(captured.response) as Json[]) : clone(captured.response);
  },
};

/** For plain tool functions: stores the return value as JSON. */
export const valueCodec: ToolCodec = {
  async capture(live) {
    return { value: live, result: toJson(live) };
  },
  revive(result) {
    return clone(result);
  },
};
