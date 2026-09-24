import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { DiffOptions } from '../diff/diff.js';
import { recordCommand, replayCommand } from '../process.js';
import { renderDiffReport } from '../report/html.js';
import { readTapeFile } from '../tape/io.js';
import { realNow } from '../runtime/context.js';

export type TapeTestStatus = 'pass' | 'fail' | 'updated' | 'skip' | 'error';

export interface TapeTestResult {
  path: string;
  name: string;
  status: TapeTestStatus;
  durationMs: number;
  /** Steps compared (pass/fail). */
  steps?: number;
  /** First-divergence explanation (fail/updated), skip reason, or error message. */
  detail?: string;
  /** HTML diff report written for a failure, if requested. */
  report?: string;
}

export interface TapeTestOptions {
  /** Re-record tapes whose replay no longer matches (makes real API calls). */
  update?: boolean;
  /** Write an HTML diff report for each failing tape into this directory. */
  reportDir?: string;
  diff?: DiffOptions;
  /** Called after each tape, for progress output. */
  onResult?: (result: TapeTestResult) => void;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.tapedeck']);
const TAPE_FILE = /\.tape\.jsonl?$/i;

/** Expands files and directories (recursively) into a sorted list of tape files. */
export function findTapes(paths: readonly string[]): string[] {
  const found = new Set<string>();
  const walk = (path: string, explicit: boolean) => {
    const stat = statSync(path);
    if (stat.isFile()) {
      if (explicit || TAPE_FILE.test(path)) found.add(path);
      return;
    }
    for (const entry of readdirSync(path)) {
      if (!SKIP_DIRS.has(entry)) walk(join(path, entry), false);
    }
  };
  for (const path of paths) walk(path, true);
  return [...found].sort();
}

function reportName(path: string): string {
  return `${basename(path).replace(TAPE_FILE, '')}.diff.html`;
}

/**
 * Replays every tape against the command it was recorded with and reports
 * which still match. The CI entry point behind `tapedeck test`.
 */
export async function runTapeTests(paths: readonly string[], options: TapeTestOptions = {}): Promise<TapeTestResult[]> {
  const results: TapeTestResult[] = [];
  for (const path of findTapes(paths)) {
    const started = realNow();
    const done = (result: Omit<TapeTestResult, 'path' | 'durationMs'>) => {
      const full = { path, durationMs: realNow() - started, ...result };
      results.push(full);
      options.onResult?.(full);
    };

    let tape;
    try {
      tape = readTapeFile(path);
    } catch (error) {
      done({ name: basename(path), status: 'error', detail: (error as Error).message });
      continue;
    }
    const name = tape.name ?? basename(path);
    const command = tape.metadata.command;
    if (!command) {
      done({ name, status: 'skip', detail: 'no recorded command (recorded in-process; test it with replayTape())' });
      continue;
    }

    try {
      const replayed = await replayCommand(command, { tape: path, stdio: 'pipe', ...(options.diff ? { diff: options.diff } : {}) });
      const steps = replayed.diff.steps.length;
      if (replayed.ok) {
        done({ name, status: 'pass', steps });
        continue;
      }
      const detail = replayed.diff.equal ? replayed.divergences.map((d) => d.message).join('\n') : replayed.diff.summary;

      if (options.update) {
        await recordCommand(command, {
          output: path,
          ...(tape.name ? { name: tape.name } : {}),
          stdio: 'pipe',
          ...(tape.metadata.llmHosts ? { llmHosts: tape.metadata.llmHosts } : {}),
          ...(tape.metadata.httpHosts ? { httpHosts: tape.metadata.httpHosts } : {}),
          ...(tape.metadata.redact ? { redact: tape.metadata.redact } : {}),
        });
        done({ name, status: 'updated', steps, detail });
        continue;
      }

      let report: string | undefined;
      if (options.reportDir) {
        mkdirSync(options.reportDir, { recursive: true });
        report = join(options.reportDir, reportName(path));
        writeFileSync(report, renderDiffReport(replayed.expected, replayed.actual, { diff: replayed.diff }));
      }
      done({ name, status: 'fail', steps, detail, ...(report ? { report } : {}) });
    } catch (error) {
      done({ name, status: 'error', detail: (error as Error).message });
    }
  }
  return results;
}

const ICONS: Record<TapeTestStatus, string> = { pass: '✅', fail: '❌', updated: '🔄', skip: '⏭️', error: '⚠️' };

/** A Markdown summary, for $GITHUB_STEP_SUMMARY or a pull-request comment. */
export function markdownSummary(results: readonly TapeTestResult[], cwd = process.cwd()): string {
  const count = (status: TapeTestStatus) => results.filter((r) => r.status === status).length;
  const failed = count('fail') + count('error');
  const lines = [
    `## ${failed ? '❌' : '✅'} TapeDeck: ${count('pass')} passed, ${failed} failed` +
      (count('updated') ? `, ${count('updated')} updated` : '') +
      (count('skip') ? `, ${count('skip')} skipped` : ''),
    '',
    '| | Tape | Steps | Time |',
    '| - | - | - | - |',
    ...results.map(
      (r) => `| ${ICONS[r.status]} | \`${relative(cwd, r.path).split('\\').join('/')}\` | ${r.steps ?? '–'} | ${r.durationMs} ms |`,
    ),
  ];
  for (const r of results.filter((x) => x.detail && (x.status === 'fail' || x.status === 'error' || x.status === 'updated'))) {
    lines.push('', `<details><summary>${ICONS[r.status]} <b>${r.name}</b></summary>`, '', '```text', r.detail!, '```', '', '</details>');
  }
  if (failed) {
    lines.push('', 'Intended change? Re-record with `npx tapedeck test --update` and commit the updated tapes.');
  }
  return `${lines.join('\n')}\n`;
}

/** GitHub Actions workflow commands that annotate failing tapes in the PR's Files view. */
export function githubAnnotations(results: readonly TapeTestResult[], cwd = process.cwd()): string[] {
  const escape = (text: string) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return results
    .filter((r) => r.status === 'fail' || r.status === 'error')
    .map((r) => {
      const file = relative(cwd, r.path).split('\\').join('/');
      return `::error file=${file},title=TapeDeck: ${escape(r.name)} diverged::${escape(r.detail ?? '')}`;
    });
}
