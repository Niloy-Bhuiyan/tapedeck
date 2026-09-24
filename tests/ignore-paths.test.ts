import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pathMatcher } from '../src/diff/deep.js';
import { diffTapes } from '../src/diff/diff.js';
import { wrapOpenAI } from '../src/interceptors/providers.js';
import { MockOpenAI } from '../src/mock/openai.js';
import { record } from '../src/record.js';
import { replay } from '../src/replay.js';

describe('pathMatcher', () => {
  const matches = (patterns: string[], path: string) => pathMatcher(patterns)(path);

  it('matches exact paths and everything below them', () => {
    expect(matches(['request.metadata'], 'request.metadata')).toBe(true);
    expect(matches(['request.metadata'], 'request.metadata.trace_id')).toBe(true);
    expect(matches(['request.metadata'], 'request.messages[0].metadata')).toBe(false);
    expect(matches(['request.meta'], 'request.metadata')).toBe(false);
  });

  it('supports * for one key, [*] for any index and ** for any depth', () => {
    expect(matches(['request.messages[*].name'], 'request.messages[3].name')).toBe(true);
    expect(matches(['request.*.trace_id'], 'request.metadata.trace_id')).toBe(true);
    expect(matches(['request.*.trace_id'], 'request.a.b.trace_id')).toBe(false);
    expect(matches(['**.trace_id'], 'response.x[2].trace_id')).toBe(true);
    expect(matches(['**.trace_id'], 'response.trace_idx')).toBe(false);
  });

  it('treats regex characters in keys literally', () => {
    expect(matches(['headers["x-id"]'], 'headers["x-id"]')).toBe(true);
    expect(matches(['a.b'], 'aXb')).toBe(false);
  });
});

/** An agent that sends an uncontrollable value (crypto.randomUUID is not captured) with every request. */
const agent = (question: string) => async () => {
  const openai = wrapOpenAI(new MockOpenAI());
  const res = await openai.chat.completions.create({
    model: 'm',
    metadata: { trace_id: randomUUID() },
    messages: [{ role: 'user', content: question }],
  });
  return res.choices[0]!.message.content;
};

describe('ignoring noisy fields', () => {
  it('diverges on a random trace ID unless the path is ignored', async () => {
    const { tape } = await record(agent('hi'));
    const strict = await replay(tape, agent('hi'));
    expect(strict.ok).toBe(false);

    const relaxed = await replay(tape, agent('hi'), { ignorePaths: ['request.metadata.trace_id'] });
    expect(relaxed.ok).toBe(true);
  });

  it('still catches real changes while ignoring noise', async () => {
    const { tape } = await record(agent('hi'));
    const res = await replay(tape, agent('bye'), { mode: 'diff', ignorePaths: ['**.trace_id'] });
    expect(res.ok).toBe(false);
    expect(res.diff.firstDivergence?.changes.map((c) => c.path)).toEqual(['request.messages[0].content']);
  });

  it('honours ignore paths saved on the baseline tape', async () => {
    const { tape } = await record(agent('hi'), { metadata: { ignorePaths: ['request.metadata'] } });
    expect((await replay(tape, agent('hi'))).ok).toBe(true);
    const other = (await record(agent('hi'))).tape;
    expect(diffTapes(tape, other).equal).toBe(true);
    expect(diffTapes(other, tape).equal).toBe(false);
  });
});
