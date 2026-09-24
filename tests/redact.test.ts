import { describe, expect, it } from 'vitest';
import { main } from '../src/cli/main.js';
import { wrapOpenAI } from '../src/interceptors/providers.js';
import { tool } from '../src/interceptors/tool.js';
import { MockOpenAI } from '../src/mock/openai.js';
import { record } from '../src/record.js';
import { replay } from '../src/replay.js';
import { DEFAULT_SECRET_PATTERNS, redactJson, REDACTED } from '../src/tape/redact.js';

const OPENAI_KEY = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWx1234';
const GOOGLE_KEY = `AIza${'x'.repeat(35)}`;

describe('redactJson', () => {
  it.each([
    ['OpenAI project key', `key=${OPENAI_KEY}`],
    ['Anthropic key', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'],
    ['Google key', GOOGLE_KEY],
    ['AWS access key', 'AKIAABCDEFGHIJKLMNOP'],
    ['GitHub token', `ghp_${'a'.repeat(36)}`],
    ['bearer token', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123'],
  ])('scrubs a %s by default', (_label, text) => {
    expect(redactJson(text, DEFAULT_SECRET_PATTERNS)).toContain(REDACTED);
  });

  it('walks nested objects and arrays and leaves other values alone', () => {
    const value = { a: [`use ${OPENAI_KEY}`, 3, null], b: { c: 'plain text', d: true } };
    expect(redactJson(value, DEFAULT_SECRET_PATTERNS)).toEqual({
      a: [`use ${REDACTED}`, 3, null],
      b: { c: 'plain text', d: true },
    });
  });

  it('does not touch ordinary prose that merely mentions keys', () => {
    expect(redactJson('ask for a sk-short key', DEFAULT_SECRET_PATTERNS)).toBe('ask for a sk-short key');
  });
});

describe('redaction during record and replay', () => {
  const agent = (secret: string, email = 'ada@example.com') => async () => {
    const openai = wrapOpenAI(new MockOpenAI());
    const lookup = tool('crm_lookup', async ({ email: e }: { email: string }) => ({ email: e, plan: 'pro' }));
    const customer = await lookup({ email });
    const res = await openai.chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: `debug with ${secret} for ${customer.email}` }],
    });
    return res.choices[0]!.message.content;
  };

  it('keeps secrets off the tape but still replays cleanly', async () => {
    const recorded = await record(agent(OPENAI_KEY));
    const text = JSON.stringify(recorded.tape);
    expect(text).not.toContain(OPENAI_KEY);
    expect(text).toContain(REDACTED);
    // The live run was not affected.
    expect(recorded.ok && recorded.result).toContain(OPENAI_KEY);

    const replayed = await replay(recorded.tape, agent(OPENAI_KEY));
    expect(replayed.ok).toBe(true);
    expect(JSON.stringify(replayed.actual)).not.toContain(OPENAI_KEY);
  });

  it('applies custom patterns and remembers them for replay', async () => {
    const recorded = await record(agent('nothing secret'), { redact: [/[\w.]+@example\.com/] });
    expect(JSON.stringify(recorded.tape)).not.toContain('ada@example.com');
    expect(recorded.tape.metadata.redact).toEqual(['[\\w.]+@example\\.com']);

    // No redact option on replay: the pattern stored on the tape is used.
    const same = await replay(recorded.tape, agent('nothing secret'));
    expect(same.ok).toBe(true);

    // A different customer is still a different run.
    const other = await replay(recorded.tape, agent('nothing secret', 'bob@elsewhere.org'), { mode: 'diff' });
    expect(other.ok).toBe(false);
  });

  it('rejects invalid patterns on the command line', async () => {
    let stderr = '';
    const code = await main(['record', '--redact', '(unclosed', '--', 'node', '-e', '1'], {
      stdout: () => {},
      stderr: (t) => (stderr += t),
      color: false,
    });
    expect(code).toBe(2);
    expect(stderr).toContain('--redact: invalid regular expression');
  });
});
