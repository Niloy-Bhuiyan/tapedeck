# Issues to open

Well-scoped work for contributors. Each item is written so it can be copied
straight into a GitHub issue. Items marked **good first issue** need little
context beyond the files listed.

---

## 1. Capture `performance.now()` — good first issue

**Why:** Agents often time steps with `performance.now()`. Today it is not
recorded, so timing-dependent logic behaves differently on replay.

**What to do:**
- In `src/runtime/globals.ts`, patch `performance.now` the same way
  `Math.random` is patched (use `sessionForGlobals()`, keep the original in
  `runtime.originals`).
- Record it as a `clock_read` with a new `source: 'performance.now'` (update
  the union in `src/tape/schema.ts` and `docs/tape-format.md`).
- Replay should return recorded values and freeze on the last one, like
  `Date.now()`. The two clocks have different origins, so `ReplaySession`
  needs separate "last value" tracking.

**Done when:** a test in `tests/runtime/globals.test.ts` shows values restored
on replay, and nothing changes outside a session.

---

## 2. Capture `crypto.randomUUID()` — good first issue

**Why:** Apps put `crypto.randomUUID()` trace IDs into requests. Today users
must `--ignore-path` those fields.

**What to do:** patch `crypto.randomUUID` (global `crypto` and `node:crypto`)
like `Math.random`, recording a new `random_draw` source (e.g.
`{ source: 'randomUUID', value: '…' }` — `value` becomes `number | string`).
Mind the caller rule in `src/runtime/caller.ts`: only app-code calls count.

**Done when:** `tests/ignore-paths.test.ts`'s trace-ID agent replays cleanly
*without* an ignore path.

---

## 3. `tapedeck replay --rerun` — good first issue

**Why:** Tapes recorded with `tapedeck record` store their command in
`metadata.command`; `--against` makes you type it again.

**What to do:** in `src/cli/main.ts`, accept `--rerun` as an alternative to
`--against` that uses `tape.metadata.command`. Error clearly if absent.

**Done when:** `tests/cli.test.ts` covers success and the "no command" error.

---

## 4. `tapedeck replay --only <types>` — good first issue

**Why:** Long timelines are noisy; often you only want the LLM calls.

**What to do:** add `--only` to the standalone `replay` command (reuse
`parseIgnore`'s validation) and a filter option to `formatTimeline`
(`src/format/text.ts`).

**Done when:** `tapedeck replay tape.json --only llm_call` prints only LLM calls.

---

## 5. Python recorder and replayer

**Why:** Most agents are written in Python. The tape format is
language-neutral JSON, so a Python package could share tapes, the diff
engine output format and even the HTML report with the Node.js tool.

**What to do:** a `tapedeck` Python package that patches `httpx` (used by
the `openai` and `anthropic` Python SDKs), `time.time`/`datetime.now` and
`random`, and writes version-1 tapes. Start with record + replay; the
Node.js CLI can already `diff` and `report` Python-made tapes.

**Done when:** a tape recorded by a Python agent replays in Python and
renders with `npx tapedeck report`.

---

## 6. Capture `node:http` / `undici` clients

**Why:** Some clients (axios, older SDKs) bypass `fetch`, so the zero-code
path misses them.

**What to do:** add an interceptor for `http.request`/`https.request` (and
possibly undici's global dispatcher) that reuses the codecs in
`src/interceptors/fetch.ts`, classifying hosts the same way.

**Done when:** an axios-based OpenAI-compatible call is recorded and replayed
in `tests/fetch.test.ts`-style tests.

---

## 7. Stream while recording

**Why:** Recording buffers streamed responses, so the recorded process
receives the whole stream at once. Fine for tests, jarring for interactive
tools.

**What to do:** in `captureHttp` (`src/interceptors/fetch.ts`), `tee()` the
body: hand one branch to the caller immediately, read the other in the
background, and fill the event when it completes. The session's `finish`
must await pending captures before the tape is written.

---

## 8. Content-based matching for concurrent agents

**Why:** Replay matches calls positionally per kind. Agents that fan out
work concurrently may issue calls in a different order from run to run.

**What to do:** add `match: 'order' | 'content'`. In `content` mode, take the
first unused recorded call with the same request hash (the stable event IDs
`<type>:<hash>:<n>` already encode it).

---

## 9. Publish to npm with provenance

**What to do:** a release workflow on `v*` tags that builds, tests and runs
`npm publish --provenance`; check contents with `npm pack --dry-run`.

---

## 10. Record and embed the README demo GIF — good first issue

**What to do:** record `npm run example:zero-code` with
[vhs](https://github.com/charmbracelet/vhs) (commit the `.tape` script) plus
a few seconds of an HTML diff report, and replace the
`<!-- TODO: record and embed a demo GIF here -->` placeholder in README.md.
