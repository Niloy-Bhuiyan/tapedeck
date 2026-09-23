import { EVENT_TYPES, TAPE_FORMAT, TAPE_VERSION, type Tape } from './schema.js';

export class TapeFormatError extends Error {
  override name = 'TapeFormatError';
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(path: string, message: string): never {
  throw new TapeFormatError(`Invalid tape at ${path}: ${message}`);
}

function expectType(obj: Obj, key: string, type: 'string' | 'number' | 'boolean', path: string, optional = false): void {
  const value = obj[key];
  if (value === undefined && optional) return;
  if (typeof value !== type) fail(`${path}.${key}`, `expected ${type}, got ${value === null ? 'null' : typeof value}`);
}

function validateError(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isObj(value)) fail(path, 'expected an error object');
  expectType(value, 'name', 'string', path);
  expectType(value, 'message', 'string', path);
}

function validateEvent(ev: unknown, index: number): void {
  const path = `events[${index}]`;
  if (!isObj(ev)) fail(path, 'expected an object');
  expectType(ev, 'id', 'string', path);
  expectType(ev, 'seq', 'number', path);
  expectType(ev, 't', 'number', path);
  if (ev.seq !== index) fail(`${path}.seq`, `expected ${index}, got ${String(ev.seq)}`);
  if (!EVENT_TYPES.includes(ev.type as never)) fail(`${path}.type`, `unknown event type ${JSON.stringify(ev.type)}`);

  switch (ev.type) {
    case 'llm_call':
      expectType(ev, 'provider', 'string', path);
      expectType(ev, 'operation', 'string', path);
      expectType(ev, 'durationMs', 'number', path);
      expectType(ev, 'stream', 'boolean', path, true);
      if (!('request' in ev)) fail(`${path}.request`, 'missing');
      validateError(ev.error, `${path}.error`);
      break;
    case 'tool_call':
      expectType(ev, 'tool', 'string', path);
      expectType(ev, 'callId', 'string', path);
      if (!('args' in ev)) fail(`${path}.args`, 'missing');
      break;
    case 'tool_result':
      expectType(ev, 'tool', 'string', path);
      expectType(ev, 'callId', 'string', path);
      expectType(ev, 'durationMs', 'number', path);
      validateError(ev.error, `${path}.error`);
      break;
    case 'clock_read':
      expectType(ev, 'value', 'number', path);
      expectType(ev, 'source', 'string', path);
      break;
    case 'random_draw':
      expectType(ev, 'value', 'number', path);
      break;
  }
}

/** Checks that `data` is a structurally valid tape and returns it typed. */
export function validateTape(data: unknown): Tape {
  if (!isObj(data)) fail('$', 'expected a JSON object');
  if (data.format !== TAPE_FORMAT) fail('$.format', `expected "${TAPE_FORMAT}", got ${JSON.stringify(data.format)}`);
  if (data.version !== TAPE_VERSION) {
    fail('$.version', `unsupported version ${JSON.stringify(data.version)} (this build reads version ${TAPE_VERSION})`);
  }
  expectType(data, 'id', 'string', '$');
  expectType(data, 'createdAt', 'string', '$');
  expectType(data, 'name', 'string', '$', true);
  if (!isObj(data.metadata)) fail('$.metadata', 'expected an object');
  if (!Array.isArray(data.events)) fail('$.events', 'expected an array');
  data.events.forEach(validateEvent);
  if (data.outcome !== undefined) {
    if (!isObj(data.outcome)) fail('$.outcome', 'expected an object');
    if (data.outcome.status !== 'ok' && data.outcome.status !== 'error') {
      fail('$.outcome.status', 'expected "ok" or "error"');
    }
    validateError(data.outcome.error, '$.outcome.error');
  }
  return data as unknown as Tape;
}
