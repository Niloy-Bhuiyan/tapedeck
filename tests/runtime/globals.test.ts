import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runInSession, runSuspended, runtime, type Session } from '../../src/runtime/context.js';
import { installGlobals, uninstallGlobals } from '../../src/runtime/globals.js';

function stubSession() {
  const reads: string[] = [];
  const session: Session = {
    mode: 'replay',
    now: (source) => {
      reads.push(source);
      return Date.UTC(2030, 0, 1);
    },
    random: () => 0.25,
    llm: async () => null,
    tool: async () => null,
  };
  return { session, reads };
}

describe('patched globals', () => {
  beforeAll(installGlobals);
  afterAll(uninstallGlobals);

  it('routes argument-less clock reads to the session', () => {
    const { session, reads } = stubSession();
    runInSession(session, () => {
      expect(Date.now()).toBe(Date.UTC(2030, 0, 1));
      expect(new Date().toISOString()).toBe('2030-01-01T00:00:00.000Z');
      expect(Date()).toContain('2030');
    });
    expect(reads).toEqual(['Date.now', 'new Date', 'Date()']);
  });

  it('leaves explicit dates and static helpers alone', () => {
    const { session, reads } = stubSession();
    runInSession(session, () => {
      expect(new Date(0).getTime()).toBe(0);
      expect(new Date('2020-02-02T00:00:00Z').getUTCFullYear()).toBe(2020);
      expect(Date.UTC(2020, 0, 1)).toBe(1577836800000);
      expect(Date.parse('2020-01-01T00:00:00Z')).toBe(1577836800000);
    });
    expect(reads).toEqual([]);
  });

  it('routes Math.random to the session', () => {
    const { session } = stubSession();
    expect(runInSession(session, () => Math.random())).toBe(0.25);
  });

  it('passes through outside a session', () => {
    const before = runtime.originals.Date.now();
    expect(Date.now()).toBeGreaterThanOrEqual(before);
    expect(Math.random()).not.toBe(0.25);
  });

  it('passes through while capture is suspended', () => {
    const { session, reads } = stubSession();
    runInSession(session, () => runSuspended(() => Date.now()));
    expect(reads).toEqual([]);
  });

  it('keeps the session across awaits and isolates concurrent scopes', async () => {
    const a = { ...stubSession().session, random: () => 0.1 };
    const b = { ...stubSession().session, random: () => 0.9 };
    const draw = async () => {
      await new Promise((r) => setTimeout(r, 5));
      return Math.random();
    };
    const results = await Promise.all([runInSession(a, draw), runInSession(b, draw)]);
    expect(results).toEqual([0.1, 0.9]);
  });

  it('preserves instanceof, subclassing and the Date name', () => {
    const { session } = stubSession();
    const original = new runtime.originals.Date();
    expect(original).toBeInstanceOf(Date);
    class Stamp extends Date {
      label() {
        return `stamp:${this.getUTCFullYear()}`;
      }
    }
    runInSession(session, () => {
      const stamp = new Stamp();
      expect(stamp).toBeInstanceOf(Stamp);
      expect(stamp).toBeInstanceOf(Date);
      expect(stamp.label()).toBe('stamp:2030');
    });
    expect(Date.name).toBe('Date');
  });

  it('is idempotent and fully reversible', () => {
    installGlobals();
    const patched = Date;
    installGlobals();
    expect(Date).toBe(patched);
    uninstallGlobals();
    expect(Date).toBe(runtime.originals.Date);
    expect(Math.random).toBe(runtime.originals.random);
    installGlobals();
  });
});
