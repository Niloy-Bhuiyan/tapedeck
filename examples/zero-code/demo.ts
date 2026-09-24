// Zero-code demo: record an unmodified OpenAI script, then replay it offline.
// Run with: npm run example:zero-code
import { join } from 'node:path';
import { formatDiff, quoteCommand, recordCommand, replayCommand } from '../../src/index.js';
import { startFakeOpenAI } from './fake-openai-server.js';

const agent = (city: string) => quoteCommand(['node', join('examples', 'zero-code', 'agent.mjs'), city]);
const tape = join('.tapedeck', 'zero-code.tape.json');
const bold = (text: string) => (process.stdout.isTTY ? `\u001b[1m${text}\u001b[22m` : text);
const say = (text: string) => process.stdout.write(`\n${bold(`▸ ${text}`)}\n`);

// MOCK: point the untouched OpenAI SDK at the fake server via its standard env vars.
const server = await startFakeOpenAI();
process.env.OPENAI_BASE_URL = server.baseURL;
process.env.OPENAI_API_KEY ??= 'sk-demo-not-a-real-key';

say(`Recording: tapedeck record -- ${agent('Lisbon')}`);
const recorded = await recordCommand(agent('Lisbon'), { output: tape, name: 'zero-code', llmHosts: [server.host] });
console.log(`  ${recorded.tape.events.length} events recorded, ${server.requests()} real API request(s) made`);

await server.close();
say('API server is now OFF. Replaying the tape against the same script…');
const same = await replayCommand(agent('Lisbon'), { tape });
console.log(`  ${same.ok ? '✓ identical run' : '✗ diverged'}, zero API calls (same date and streamed text, offline)`);

say('Replaying against a changed script (different prompt)…');
const changed = await replayCommand(agent('Porto'), { tape, stdio: 'pipe' });
console.log(formatDiff(changed.diff, { color: Boolean(process.stdout.isTTY) }));
process.exitCode = same.ok && !changed.ok ? 0 : 1;
