import { serializeError, toJson } from '../tape/json.js';
import { TapeRecorder } from '../tape/recorder.js';
import type { ClockReadEvent, Tape, TapeMetadata, TapeOutcome } from '../tape/schema.js';
import { realNow, realRandom, runSuspended, type LlmRequest, type Session } from './context.js';
import { collectStream, isStreamRequest, streamOf } from './stream.js';

/**
 * Performs every call for real and writes what happened to a tape.
 * Callers see exactly what they would have seen without TapeDeck.
 */
export class RecordSession implements Session {
  readonly mode = 'record' as const;
  readonly recorder = new TapeRecorder(realNow);

  now(source: ClockReadEvent['source']): number {
    const value = realNow();
    this.recorder.append({ type: 'clock_read', source, value });
    return value;
  }

  random(): number {
    const value = realRandom();
    this.recorder.append({ type: 'random_draw', value });
    return value;
  }

  async llm(call: LlmRequest, invoke: () => Promise<unknown>): Promise<unknown> {
    const event = this.recorder.append({
      type: 'llm_call',
      provider: call.provider,
      operation: call.operation,
      request: toJson(call.request),
      durationMs: 0,
    });
    const start = realNow();
    try {
      const response = await runSuspended(invoke);
      if (!isStreamRequest(call.request)) {
        event.response = toJson(response);
        return response;
      }
      // Streams are buffered so the chunks can be recorded, then re-emitted.
      const chunks = await runSuspended(() => collectStream(response));
      event.stream = true;
      event.response = toJson(chunks);
      return streamOf(chunks);
    } catch (error) {
      event.error = serializeError(error);
      throw error;
    } finally {
      event.durationMs = realNow() - start;
    }
  }

  async tool(name: string, args: unknown, invoke: () => Promise<unknown>): Promise<unknown> {
    const call = this.recorder.append({ type: 'tool_call', tool: name, callId: '', args: toJson(args) });
    call.callId = call.id;
    const start = realNow();
    try {
      const result = await runSuspended(invoke);
      this.recorder.append({
        type: 'tool_result',
        tool: name,
        callId: call.callId,
        result: toJson(result),
        durationMs: realNow() - start,
      });
      return result;
    } catch (error) {
      this.recorder.append({
        type: 'tool_result',
        tool: name,
        callId: call.callId,
        error: serializeError(error),
        durationMs: realNow() - start,
      });
      throw error;
    }
  }

  toTape(options: { name?: string; metadata?: TapeMetadata; outcome?: TapeOutcome } = {}): Tape {
    return this.recorder.toTape(options);
  }
}
