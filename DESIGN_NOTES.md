# Design notes

Decisions that shape TapeDeck's public API, and why. Where there was a
genuine fork, the more conventional option was chosen.

## Explicit wrapping instead of auto-instrumentation

Apps opt in with `wrapOpenAI(client)`, `wrapAnthropic(client)` and
`tool(name, fn)`. The alternative — monkey-patching SDK prototypes when the
module loads — works without code changes but breaks whenever an SDK
reorganises its internals, and silently records nothing when it does. Explicit
wrappers are the convention in the LLM-observability space (Langfuse,
Helicone, OpenLLMetry's manual mode), are type-safe, and fail loudly. Because
the wrapper is a `Proxy`, the wrapped client keeps the full SDK surface;
only the listed operations are intercepted.

## Tools take one JSON argument

`tool(name, fn)` wraps `(input) => output`. That matches how LLM tool calling
works (one JSON arguments object), gives readable diff paths
(`args.query` rather than `args[0].query`), and keeps tape events
self-describing.

## Scoping with AsyncLocalStorage

`Date` and `Math.random` are patched globally, but the patches consult an
`AsyncLocalStorage` store and pass straight through when there is no active
session. That means:

- `record()` / `replay()` capture only what their callback (and everything
  it awaits) does, so parallel tests do not interfere.
- Real SDK calls and tool bodies run with capture *suspended*: they are
  replayed as a whole, so their internal clock reads must not appear on the
  tape.
- CLI-driven runs bind the session with `enterWith` when the app imports
  `tapedeck`, rather than using a process-global fallback. Work scheduled
  before that point (e.g. tsx's disk-cache maintenance) keeps its own
  context and stays off the tape. A `--import tapedeck/register` preload was
  tried and dropped: `enterWith` in a preload does not propagate into the
  main module's evaluation.

Runtime state lives on `globalThis[Symbol.for('tapedeck.runtime.v1')]` so
two copies of the library in one process (say `dist/` and `src/`) share one
registry and — critically — capture the *original* globals exactly once.

## Matching: per-kind queues in recorded order

Replay consumes LLM calls, tool calls, clock reads and random draws from
separate queues. Positional matching per kind is what VCR-style tools
(Polly.js, nock, vcrpy's default) do and is predictable. Keeping kinds
separate means one extra `Date.now()` does not shift every LLM response.
Events are ordered by *start* time, so concurrent calls replay in the order
they were issued.

Once the recorded clock values run out the clock freezes at the last value,
and random draws continue from a PRNG seeded by the tape ID. Replay stays
deterministic for code that reads the clock more often than before; the
extra reads show up in the diff.

## Strict vs diff mode

- **strict** (default for `replay()`): throw `TapeDivergenceError` at the
  first LLM/tool call whose inputs differ from the tape. Clock and random
  reads are lenient in both modes; differences there show up in the diff.
- **diff** (default for `replayTape()` and `tapedeck replay --against`): note
  the divergence, answer from the tape anyway, and keep going so every
  difference is reported.
- A call the tape cannot answer at all (an extra call) always fails, unless
  `passthrough` is enabled, in which case it is performed for real.

Replay results are judged on both the divergences seen during the run *and*
a full diff of the source tape against a tape of the replay run.

## Diff alignment

Tapes are aligned with a longest-common-subsequence match over
`type + tool/provider/operation` keys, after trimming the shared prefix and
suffix (so near-identical long runs stay cheap). Aligned pairs are compared
field by field on their behaviour-relevant payload; IDs, timings and
correlation IDs are ignored. A renamed tool therefore shows up as a removal
plus an addition, and changed arguments as a change.

## Record never throws on the app's behalf

`record()` returns `{ ok, result | error, tape }` instead of re-throwing,
because a run that errors is still a valid (and often the most interesting)
tape. `replay()` follows the same shape.

## ESM only, Node 22+

TapeDeck ships as an ES module. Both official SDKs, Vitest and modern Node
tooling are ESM-first; a dual build adds the "dual package hazard" on top of
the global-state concerns above. Jest users need Jest's ESM mode.

## Zero runtime dependencies

The CLI uses `node:util`'s `parseArgs`, colours are a dozen lines of ANSI,
the report is hand-rolled HTML/CSS/JS. The SDKs are optional peer
dependencies: TapeDeck never imports them at runtime; the wrappers are
generic over any object with the right shape.

## Known limitations

- Streaming responses are recorded by buffering the whole stream, then
  re-emitted as a plain async iterable (SDK stream helper methods such as
  `.toReadableStream()` are not available on intercepted calls).
- Intercepted methods return plain Promises, so `.withResponse()` /
  `.asResponse()` are not available on them.
- `performance.now()`, `crypto.randomUUID()` and `crypto.getRandomValues()`
  are not captured (see ISSUES_TODO.md).
