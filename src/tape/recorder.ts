import { randomUUID } from 'node:crypto';
import { shortHash } from './json.js';
import {
  TAPE_FORMAT,
  TAPE_VERSION,
  type Tape,
  type TapeEvent,
  type TapeMetadata,
  type TapeOutcome,
} from './schema.js';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event as supplied by the caller; `id`, `seq` and `t` are assigned by the recorder. */
export type EventInput = DistributiveOmit<TapeEvent, 'id' | 'seq' | 't'>;

/** The parts of an event that identify it, used to derive its stable ID. */
function identityOf(event: EventInput): unknown {
  switch (event.type) {
    case 'llm_call':
      return [event.type, event.provider, event.operation, event.request];
    case 'tool_call':
      return [event.type, event.tool, event.args];
    case 'tool_result':
      return [event.type, event.tool, event.callId];
    case 'clock_read':
    case 'random_draw':
      return [event.type];
  }
}

/**
 * Accumulates events into a tape.
 *
 * Event IDs have the form `<type>:<hash>:<n>` where `hash` covers the event's
 * inputs and `n` counts earlier events with the same inputs. Two runs that do
 * the same thing therefore produce the same IDs, and an extra or missing
 * event elsewhere in the run does not shift the IDs of unrelated events.
 */
export class TapeRecorder {
  readonly events: TapeEvent[] = [];
  readonly startedAt: number;
  private readonly occurrences = new Map<string, number>();

  /** @param now wall-clock source; must not be a patched/replayed clock. */
  constructor(private readonly now: () => number) {
    this.startedAt = now();
  }

  /**
   * Appends an event and returns the stored object. Callers may fill in
   * late-arriving fields (e.g. an LLM response) on the returned object, which
   * keeps events ordered by when they started rather than when they finished.
   */
  append<E extends EventInput>(input: E): Extract<TapeEvent, { type: E['type'] }> {
    const hash = shortHash(identityOf(input));
    const n = this.occurrences.get(hash) ?? 0;
    this.occurrences.set(hash, n + 1);
    const event = {
      id: `${input.type}:${hash}:${n}`,
      seq: this.events.length,
      t: this.now() - this.startedAt,
      ...(input as EventInput),
    } as TapeEvent;
    this.events.push(event);
    return event as Extract<TapeEvent, { type: E['type'] }>;
  }

  /** Milliseconds elapsed since `start`, measured on the recorder's clock. */
  elapsedSince(start: number): number {
    return this.now() - start;
  }

  clockNow(): number {
    return this.now();
  }

  toTape(options: { name?: string; metadata?: TapeMetadata; outcome?: TapeOutcome } = {}): Tape {
    const tape: Tape = {
      format: TAPE_FORMAT,
      version: TAPE_VERSION,
      id: randomUUID(),
      createdAt: new Date(this.startedAt).toISOString(),
      metadata: options.metadata ?? {},
      events: this.events,
    };
    if (options.name !== undefined) tape.name = options.name;
    if (options.outcome !== undefined) tape.outcome = options.outcome;
    return tape;
  }
}
