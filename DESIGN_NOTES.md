# Design notes

Decisions that shape TapeDeck's public API, and why. Where there was a
genuine fork, the more conventional option was chosen; where a later version
changed course, the reasoning is kept here.

## Capture at the network level (fetch), with SDK wrappers as an option

**v0.1** required apps to wrap their clients (`wrapOpenAI`, `wrapAnthropic`).
That is conventional in LLM observability, but it is the single biggest
barrier to trying a tool: you have to change code before you see any value.

**v0.2** captures at the `fetch` level by default. Every major JS LLM client —
the official OpenAI and Anthropic SDKs, Vercel AI SDK, LangChain.js, Google's
SDK — sends JSON over `fetch`, and the HTTP API is a far more stable contract
than any SDK's internals, so one interceptor covers them all. Monkey-patching
SDK prototypes was rejected for the reason it was in v0.1: it breaks silently
when an SDK reorganises.

Consequences:

- Requests are recorded as the JSON **body** (so diffs read exactly like the
  SDK call), keyed by `<METHOD> <path>` and a provider derived from the host.
  Request headers — where API keys live — are never stored.
- Responses are replayed as real `Response` objects, so the SDK's own
  parsing, error handling and **streaming** code runs unchanged. SSE bodies
  are stored as parsed frames (readable, diffable) and re-serialised exactly.
- Recorded 429/5xx responses are replayed with `retry-after-ms: 0`, so SDK
  retries on the tape replay instantly.
- SDKs capture `fetch` when a client is constructed, so the patch must be in
  place first: importing `tapedeck` installs it, and the CLI preloads it.
- The SDK wrappers remain for SDK-level recording (method paths as
  operations); calls made through them run with capture suspended, so they
  are never double-recorded by the fetch layer.

Only known LLM hosts are captured by default. Other hosts are opt-in
(`--http-host`, recorded as tool events) because background traffic such as
telemetry would otherwise make tapes nondeterministic.

## Zero-code CLI via a preload

`tapedeck record` / `replay --against` add `--import <tapedeck/register>` to
`NODE_OPTIONS`. The preload starts a process-wide session before any app
code runs.

This was tried and dropped in v0.1, when sessions were bound with
`AsyncLocalStorage.enterWith` (which does not propagate from a preload into
the main module) and when clock-read noise from tooling had no filter. v0.2
uses a process-wide fallback session plus the caller rule below, which
solves both.

Every Node process in the command's tree loads the preload (npx, tsx
wrappers, the app). A process only writes the tape if it made LLM or tool
calls, or if nothing has been written yet, so wrappers that exit last never
clobber the real tape.

## Only application code's clock reads and random draws

`Date` and `Math.random` are patched globally, but a read is recorded only if
its nearest caller outside TapeDeck is a real file **outside
`node_modules`**. Reads inside dependencies — SDK retry jitter and timeouts,
a TypeScript loader tidying its cache, npm itself — run for real.

v0.1 recorded every read inside a session. That made tapes depend on
library internals: upgrading an SDK could change the number of reads and
shift every recorded clock value. The caller rule keeps tapes stable across
dependency upgrades and makes "what gets recorded" easy to explain. The cost
is a stack capture per read inside a session, which is negligible next to an
LLM call.

## Scoping with AsyncLocalStorage

`record()` / `replay()` bind their session with `AsyncLocalStorage`, so they
capture only what their callback (and everything it awaits) does and
parallel tests never interfere. Scoped sessions take precedence over the
process-wide CLI session. Real SDK and tool calls made through wrappers run
with capture suspended.

Runtime state lives on `globalThis[Symbol.for('tapedeck.runtime.v1')]` so two
copies of the library in one process share one registry and capture the
*original* globals exactly once.

## Matching: per-kind queues in recorded order

Replay consumes LLM calls, tool calls, clock reads and random draws from
separate queues. Positional matching per kind is what VCR-style tools
(Polly.js, nock, vcrpy's default) do and is predictable; keeping kinds
separate means one extra `Date.now()` does not shift every LLM response.
Events are ordered by *start* time, so concurrent calls replay in the order
they were issued. Once the recorded values run out, the clock freezes and
random draws continue from a PRNG seeded by the tape ID.

## Strict vs diff mode

- **strict** (default for `replay()`): throw `TapeDivergenceError` at the
  first LLM/tool call whose inputs differ from the tape.
- **diff** (default for the CLI, `tapedeck test` and `replayTape()`): note the
  divergence, answer from the tape anyway, and keep going so every
  difference is reported.
- A call the tape cannot answer at all fails, unless `passthrough` is on.

## Redaction by default, reapplied on replay

Tapes are meant to be committed, so secrets must never reach them. Request
headers are not recorded at all, secret-looking URL query values are
redacted, and every string in a tape is scrubbed for well-known credential
formats before it is written, plus any user patterns. Because a redacted
request no longer equals the live one, replay redacts live requests with the
same patterns (stored on the tape) before comparing.

## Ignoring noisy fields

Some request fields cannot be made deterministic (a `crypto.randomUUID()`
trace ID, a library-added timestamp). `ignorePaths` takes path patterns in
the same syntax diffs print (`request.messages[*].name`, `**.trace_id`) and
applies them to both call matching and diffs. Paths given at record time are
saved on the tape, so every later replay and `tapedeck test` honours them.

## Diff alignment

Tapes are aligned with a longest-common-subsequence match over
`type + tool/provider/operation` keys, after trimming the shared prefix and
suffix. Aligned pairs are compared field by field on their
behaviour-relevant payload; IDs, timings and correlation IDs are ignored.

## Snapshot-style workflow

`tapedeck test` mirrors Jest snapshots on purpose: tapes are the snapshots,
a mismatch fails CI with a readable diff, and `--update` re-records the tapes
that changed. It is the workflow developers already know for "this output is
expected to stay the same unless I say so".

## Record never throws on the app's behalf

`record()` returns `{ ok, result | error, tape }` instead of re-throwing,
because a run that errors is still a valid (and often the most interesting)
tape. `replay()` follows the same shape.

## ESM only, Node 22+, zero runtime dependencies

TapeDeck ships as an ES module (the SDKs, Vitest and modern Node tooling are
ESM-first; a dual build would add the dual-package hazard to the global-state
concerns above). The CLI uses `node:util`'s `parseArgs`; the report is
hand-written HTML/CSS/JS. The SDKs are optional peer dependencies and are
never imported at runtime.

## Known limitations

- Node.js only. The tape format is language-neutral; a Python recorder is
  the most valuable next step.
- `fetch` only: clients built directly on `node:http` (axios, older SDKs)
  need the explicit wrappers or `tool()`.
- Streams are buffered while recording (the caller receives a response once
  the stream completes); replay is exact.
- `performance.now()`, `crypto.randomUUID()` and `crypto.getRandomValues()`
  are not captured.
