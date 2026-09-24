import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { diffTapes, type DiffOptions } from '../diff/diff.js';
import { colorEnabled, palette } from '../format/colors.js';
import { formatDiff, formatTimeline } from '../format/text.js';
import { quoteCommand, recordCommand, replayCommand } from '../process.js';
import { renderDiffReport, renderTapeReport } from '../report/html.js';
import { readTapeFile } from '../tape/io.js';
import { EVENT_TYPES, type EventType } from '../tape/schema.js';
import { VERSION } from '../version.js';

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  color: boolean;
}

export const USAGE = `tapedeck ${VERSION} — VCR for AI agents

Usage:
  tapedeck record [-o <tape>] [-n <name>] -- <command...>
      Run a Node.js command for real and record its LLM calls, tool calls,
      clock reads and random draws into a tape. No code changes needed.

  tapedeck replay <tape>
      Play a tape back as a timeline (zero API cost, runs no code).

  tapedeck replay <tape> --against "<command>" [--strict] [--passthrough] [-o <tape>]
      Run a command with every recorded call answered from the tape, then
      diff what it did against the tape. Exits 1 if they differ.

  tapedeck diff <tape-a> <tape-b>
      Compare two tapes step by step. Exits 1 if they differ.

  tapedeck report <tape> [--diff <tape-b>] [-o <file.html>]
      Render a tape, or a diff of two tapes, as a self-contained HTML page.

Options:
  -o, --output <path>     Where to write the tape / report
  -n, --name <name>       Name stored on a recorded tape
      --against <command> Command to replay the tape against
      --strict            Stop at the first divergence (default: report all)
      --passthrough       Perform calls the tape cannot answer for real (costs money)
      --ignore <types>    Comma-separated event types to leave out of diffs,
                          e.g. clock_read,random_draw
      --llm-host <host>   Also treat this host as an LLM API (repeatable),
                          e.g. localhost:11434 for Ollama
      --http-host <host>  Record calls to this non-LLM host as tools (repeatable),
                          e.g. api.tavily.com
      --json              Print machine-readable JSON instead of text
  -h, --help              Show this help
  -v, --version           Show the version

Calls to OpenAI, Anthropic, Google, Mistral, Groq, OpenRouter and other
well-known LLM APIs made through fetch are recorded automatically.
`;

export class UsageError extends Error {
  override name = 'UsageError';
}

function parseIgnore(value: string | undefined): DiffOptions {
  if (!value) return {};
  const types = value.split(',').map((t) => t.trim()).filter(Boolean);
  for (const type of types) {
    if (!EVENT_TYPES.includes(type as EventType)) {
      throw new UsageError(`--ignore: unknown event type "${type}" (expected one of ${EVENT_TYPES.join(', ')})`);
    }
  }
  return { ignoreTypes: types as EventType[] };
}

const HOST_OPTIONS = {
  'llm-host': { type: 'string', multiple: true },
  'http-host': { type: 'string', multiple: true },
} as const;

function hostOptions(values: { 'llm-host'?: string[]; 'http-host'?: string[] }) {
  return {
    ...(values['llm-host']?.length ? { llmHosts: values['llm-host'] } : {}),
    ...(values['http-host']?.length ? { httpHosts: values['http-host'] } : {}),
  };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'recording';
}

async function recordCmd(argv: string[], io: CliIO): Promise<number> {
  const split = argv.indexOf('--');
  const own = split === -1 ? argv : argv.slice(0, split);
  const { values, positionals } = parseArgs({
    args: own,
    allowPositionals: split === -1,
    options: {
      output: { type: 'string', short: 'o' },
      name: { type: 'string', short: 'n' },
      ...HOST_OPTIONS,
    },
  });
  const commandArgs = split === -1 ? positionals : argv.slice(split + 1);
  if (commandArgs.length === 0) throw new UsageError('record: missing command, e.g. tapedeck record -- node agent.js');

  const command = quoteCommand(commandArgs);
  const output = values.output ?? `tapes/${slug(values.name ?? 'recording')}.tape.json`;
  const run = await recordCommand(command, {
    output,
    ...(values.name ? { name: values.name } : {}),
    ...hostOptions(values),
  });
  const c = palette(io.color);
  io.stderr(
    `${c.green('●')} Recorded ${run.tape.events.length} events → ${output} ${c.dim(`(exit code ${run.exitCode})`)}\n`,
  );
  return run.exitCode;
}

async function replayCmd(argv: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      against: { type: 'string' },
      strict: { type: 'boolean', default: false },
      passthrough: { type: 'boolean', default: false },
      output: { type: 'string', short: 'o' },
      ignore: { type: 'string' },
      json: { type: 'boolean', default: false },
      ...HOST_OPTIONS,
    },
  });
  const [tapePath, ...rest] = positionals;
  if (!tapePath || rest.length > 0) throw new UsageError('replay: expected exactly one tape file');

  if (values.against === undefined) {
    const tape = readTapeFile(tapePath);
    io.stdout(values.json ? `${JSON.stringify(tape, null, 2)}\n` : `${formatTimeline(tape, { color: io.color })}\n`);
    return 0;
  }

  const result = await replayCommand(values.against, {
    tape: tapePath,
    mode: values.strict ? 'strict' : 'diff',
    passthrough: values.passthrough,
    diff: parseIgnore(values.ignore),
    ...(values.output ? { output: values.output } : {}),
    ...hostOptions(values),
  });

  if (values.json) {
    const { ok, exitCode, divergences, diff } = result;
    io.stdout(`${JSON.stringify({ ok, exitCode, divergences, diff }, null, 2)}\n`);
    return ok ? 0 : 1;
  }
  const c = palette(io.color);
  io.stdout(`\n${c.bold('Replay diff')} ${c.dim(`${tapePath} vs "${values.against}"`)}\n`);
  if (result.divergences.length > 0) {
    io.stdout(`${c.yellow(`${result.divergences.length} divergence(s) during replay:`)}\n`);
    for (const d of result.divergences) io.stdout(`  ${c.yellow('!')} ${d.message}\n`);
    io.stdout('\n');
  }
  io.stdout(`${formatDiff(result.diff, { color: io.color })}\n`);
  if (values.output) io.stdout(c.dim(`Replay tape written to ${values.output}\n`));
  return result.ok ? 0 : 1;
}

function diffCmd(argv: string[], io: CliIO): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { ignore: { type: 'string' }, json: { type: 'boolean', default: false } },
  });
  if (positionals.length !== 2) throw new UsageError('diff: expected two tape files');
  const diff = diffTapes(readTapeFile(positionals[0]!), readTapeFile(positionals[1]!), parseIgnore(values.ignore));
  io.stdout(values.json ? `${JSON.stringify(diff, null, 2)}\n` : `${formatDiff(diff, { color: io.color })}\n`);
  return diff.equal ? 0 : 1;
}

function reportCmd(argv: string[], io: CliIO): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { diff: { type: 'string' }, output: { type: 'string', short: 'o' }, ignore: { type: 'string' } },
  });
  if (positionals.length !== 1) throw new UsageError('report: expected one tape file (use --diff <tape-b> to compare)');
  const tape = readTapeFile(positionals[0]!);
  const html = values.diff
    ? renderDiffReport(tape, readTapeFile(values.diff), parseIgnore(values.ignore))
    : renderTapeReport(tape);
  const output = values.output ?? 'tapedeck-report.html';
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html);
  io.stderr(`${palette(io.color).green('●')} Report written to ${output}
`);
  return 0;
}

/** Runs the CLI and returns the process exit code. */
export async function main(argv: string[], io: CliIO): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'record':
        return await recordCmd(rest, io);
      case 'replay':
        return await replayCmd(rest, io);
      case 'diff':
        return diffCmd(rest, io);
      case 'report':
        return reportCmd(rest, io);
      case '-v':
      case '--version':
        io.stdout(`${VERSION}\n`);
        return 0;
      case undefined:
      case '-h':
      case '--help':
      case 'help':
        io.stdout(USAGE);
        return 0;
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`tapedeck: ${message}\n`);
    const usage =
      error instanceof UsageError || (error instanceof Error && String((error as { code?: unknown }).code).startsWith('ERR_PARSE_ARGS'));
    if (usage) io.stderr('Run "tapedeck --help" for usage.\n');
    return usage ? 2 : 1;
  }
}

export function defaultIO(): CliIO {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    color: colorEnabled(process.stdout),
  };
}
