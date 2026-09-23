# Issues to open

Well-scoped work for new contributors. Each item is written so it can be
copied straight into a GitHub issue. Items marked **good first issue** need
little context beyond the files listed.

---

## 1. Capture `performance.now()` — good first issue

**Why:** Agents often time steps with `performance.now()`. Today it is not
recorded, so timing-dependent logic behaves differently on replay.

**What to do:**
- In `src/runtime/globals.ts`, patch `performance.now` the same way
  `Math.random` is patched (consult `currentSession()`, pass through
  otherwise, keep the original in `runtime.originals`).
- Record it as a `clock_read` with a new `source: 'performance.now'`, and
  add that source to the union in `src/tape/schema.ts` and to
  `docs/tape-format.md`.
- Replay should return recorded values and freeze on the last one, like
  `Date.now()`. Note the two clocks have different origins, so they need
  separate "last value" tracking in `ReplaySession`.

**Done when:** a test in `tests/runtime/globals.test.ts` shows
`performance.now()` values restored on replay, and nothing changes outside
a session.

---

## 2. `tapedeck replay --against` without a command — good first issue

**Why:** Tapes recorded with `tapedeck record` already store the command in
`metadata.command`. Typing it again is tedious.

**What to do:** in `src/cli/main.ts`, accept `--rerun` (boolean) as an
alternative to `--against`, which uses `tape.metadata.command`. Error
clearly if the tape has no command. Update the usage text and README.

**Done when:** `tests/cli.test.ts` covers both the success case and the
"no recorded command" error.

---

## 3. Add a `--filter` option to `tapedeck replay` timeline — good first issue

**Why:** Long tapes are noisy; often you only want the LLM calls.

**What to do:** add `--only <types>` to the standalone `replay` command,
reusing `parseIgnore`'s validation in `src/cli/main.ts`, and filter events
in `formatTimeline` (`src/format/text.ts`) via a new option.

**Done when:** `tapedeck replay tape.json --only llm_call` prints only LLM
calls, with tests in `tests/format.test.ts` and `tests/cli.test.ts`.

---

## 4. Redact secrets and PII from tapes

**Why:** Tapes contain full prompts and responses, which may include API
keys, emails or customer data. Users need to commit tapes safely.

**What to do:** add a `redact` option to `record()` / `tapedeck record`
(e.g. a list of JSON paths and/or regexes) applied to events before they are
written. Redaction must be applied identically when *comparing* requests on
replay, or replays will always diverge — so the replay session must redact
the live request before matching.

**Done when:** a redacted tape still replays cleanly, and redacted values
never reach disk.

---

## 5. Stream-faithful replay for OpenAI and Anthropic

**Why:** Streams are currently buffered during recording and replayed as a
plain async iterable, so SDK stream helpers (`.toReadableStream()`,
`.finalMessage()`, `on('text')`) are unavailable on intercepted calls.

**What to do:** in `src/runtime/stream.ts`, reconstruct the SDK's own
`Stream` object from recorded chunks when the SDK is available (both SDKs
can build a stream from a `ReadableStream` of SSE lines), falling back to the
plain iterable otherwise.

**Done when:** `tests/sdk.test.ts` records and replays a `stream: true` call
through the real SDK and consumes it with an SDK helper method.

---

## 6. Content-based matching mode for concurrent agents

**Why:** Replay matches LLM and tool calls positionally per kind. Agents
that fan out work concurrently may issue calls in a different order from
run to run, which shows up as spurious divergences.

**What to do:** add `match: 'order' | 'content'` to replay options. In
`content` mode, look up the recorded call with the same request hash
(first unused one) instead of taking the next in the queue. The stable
event IDs (`<type>:<hash>:<n>`) already encode that hash.

**Done when:** a test with `Promise.all` over calls that finish in random
order replays cleanly in `content` mode.

---

## 7. Publish the package to npm with provenance

**Why:** `npm install tapedeck` should just work.

**What to do:** add a release workflow (`.github/workflows/release.yml`)
that runs on tags `v*`, builds, tests and runs `npm publish --provenance`.
Check the package contents with `npm pack --dry-run` first.

**Done when:** a tagged release publishes and `npx tapedeck --version` works.

---

## 8. Record and embed the README demo GIF — good first issue

**Why:** The README has a `<!-- TODO: record and embed a demo GIF here -->`
placeholder.

**What to do:** record `npm run example:replay` and
`npm run example:regression` in a terminal (e.g. with
[vhs](https://github.com/charmbracelet/vhs) — commit the `.tape` script so it
can be re-rendered) plus a few seconds of the HTML report, and embed it.
