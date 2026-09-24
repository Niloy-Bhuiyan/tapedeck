# Tape format (version 1)

A **tape** is a portable record of one agent run. It captures every
non-deterministic input the run consumed, in the order it was consumed, so
the run can be reproduced later without network access.

Tapes are plain JSON. Two on-disk layouts are supported and are
interchangeable:

| Layout | Extension     | Shape                                                               |
| ------ | ------------- | ------------------------------------------------------------------- |
| JSON   | `.tape.json`  | One pretty-printed object. Best for committing and code review.     |
| JSONL  | `.tape.jsonl` | Line 1 is the tape header (everything except `events`); each following line is one event. Best for very long runs and streaming tools. |

The TypeScript definitions live in [`src/tape/schema.ts`](../src/tape/schema.ts)
and are exported from the package as `Tape`, `TapeEvent`, etc.

## Top-level object

```jsonc
{
  "format": "tapedeck.tape",        // constant marker
  "version": 1,                     // format version; readers reject unknown versions
  "id": "2f0c…",                    // unique per recording (UUID)
  "name": "checkout-flow",          // optional human label
  "createdAt": "2026-09-23T10:00:00.000Z",
  "metadata": {                     // free-form; well-known keys below
    "tapedeckVersion": "0.2.0",
    "command": "node agent.js",     // set by `tapedeck record -- <command>`
    "node": "v22.4.0",
    "llmHosts": ["localhost:11434"],        // --llm-host: extra hosts captured as LLM calls
    "httpHosts": ["api.tavily.com"],        // --http-host: hosts captured as http tools
    "redact": ["[\w.]+@example\.com"],     // --redact: extra patterns scrubbed from the tape
    "ignorePaths": ["request.metadata"],    // --ignore-path: fields ignored when replaying/diffing
    "replay": { … }                 // only on tapes produced by a replay run
  },
  "events": [ … ],                  // ordered, see below
  "outcome": {                      // how the run ended (optional)
    "status": "ok",                 // "ok" | "error"
    "value": { … },                 // return value (in-process recordings)
    "error": { "name": "…", "message": "…" },
    "exitCode": 0                   // CLI recordings
  }
}
```

## Events

Every event shares these fields:

| Field  | Type   | Meaning |
| ------ | ------ | ------- |
| `id`   | string | Stable ID: `<type>:<hash>:<n>`. `hash` is the first 8 hex chars of the SHA-256 of the event's *inputs* (canonical JSON), `n` counts earlier events with the same inputs. Identical runs produce identical IDs, and inserting an unrelated event does not renumber the others. |
| `seq`  | number | Zero-based position in `events`. Always equals the array index. |
| `t`    | number | Milliseconds since recording started (real wall clock; informational only, ignored by diffs). |
| `type` | string | One of the five types below. |

Events are ordered by **when they started**. An LLM call that is still in
flight when the code reads the clock appears *before* that clock read even
though its response arrived later.

### `llm_call`

A call to an LLM API, captured one of two ways:

- **Network level** (default; no code changes): a `fetch` to a known LLM
  host. `operation` is `<METHOD> <path>` and the event carries `http`.
- **SDK level** (`wrapOpenAI` / `wrapAnthropic` / `wrapClient`): a call to
  an SDK method. `operation` is the method path.

| Field        | Type    | Notes |
| ------------ | ------- | ----- |
| `provider`   | string  | `openai`, `anthropic`, `google`, …, or the host itself for `--llm-host` hosts. |
| `operation`  | string  | `POST /v1/chat/completions` (network level; secret-looking query values redacted) or `chat.completions.create` (SDK level). |
| `request`    | JSON    | The request body. Request **headers are never recorded**, and neither are per-request SDK options such as `signal`. |
| `response`   | JSON    | The response body (network level) or object (SDK level). For streams: the list of server-sent events `{ event?, data }` (network level, `data` parsed as JSON when possible) or of SDK chunks (SDK level). |
| `stream`     | boolean | Present and `true` for streamed calls. |
| `http`       | object  | Network level only: `{ status, headers }`, where `headers` keeps only `content-type`, `retry-after` and `retry-after-ms`. |
| `error`      | object  | `{ name, message, status?, code? }` when the call threw (e.g. a network error). HTTP error statuses are ordinary responses with `http.status` ≥ 400. |
| `durationMs` | number  | Real latency during recording. |

ID inputs: `provider`, `operation`, `request`.

### `tool_call` / `tool_result`

A call to a function wrapped with `tool(name, fn)`, split into the call
(what the agent asked for) and the result (what it got back).

Calls to hosts given with `--http-host` are recorded as tools too, named
`http <host>`, with `args: { method, url, body }` and
`result: { status, headers, body, stream? }`.

| Field        | Type   | Notes |
| ------------ | ------ | ----- |
| `tool`       | string | Tool name. |
| `callId`     | string | Links the pair. Equal to the `tool_call` event's `id`. |
| `args`       | JSON   | *(tool_call)* The input passed to the tool. |
| `result`     | JSON   | *(tool_result)* The returned value. |
| `error`      | object | *(tool_result)* Present when the tool threw. |
| `durationMs` | number | *(tool_result)* Real latency during recording. |

ID inputs: `tool` + `args` for calls, `tool` + `callId` for results.

### `clock_read`

The application read the current time. Only reads made directly by
application code are recorded — not reads inside `node_modules` (SDK retry
logic, loaders), which run for real on replay. This keeps tapes stable
across dependency upgrades.

| Field    | Type   | Notes |
| -------- | ------ | ----- |
| `source` | string | `Date.now`, `new Date` (no arguments) or `Date()`. |
| `value`  | number | Epoch milliseconds returned to the code. |

### `random_draw`

Application code called `Math.random()` (same rule as `clock_read`).

| Field   | Type   | Notes |
| ------- | ------ | ----- |
| `value` | number | The value in `[0, 1)` returned to the code. |

## What is *not* captured

- Clock reads and random draws made inside dependencies (see above), inside
  a wrapped tool, or inside an SDK-level wrapped call.
- `performance.now()`, `crypto.randomUUID()`, `crypto.getRandomValues()`,
  file-system reads, and `fetch` calls to hosts that are neither known LLM
  APIs nor listed with `--llm-host` / `--http-host`. Wrap such dependencies
  with `tool()` if the agent's behaviour depends on them, or ignore the
  fields they affect with `ignorePaths`.

## Redaction

Before a tape is written, every string in it is scanned and well-known
credential formats (OpenAI/Anthropic/Google API keys, AWS access key IDs,
GitHub and Slack tokens, bearer tokens) are replaced with `[REDACTED]`,
along with any patterns in `metadata.redact`. On replay, live requests are
redacted the same way before being compared with the tape.

## Replay metadata

A tape produced by a replay run carries `metadata.replay`:

```jsonc
{
  "sourceTapeId": "2f0c…",       // the tape that was replayed
  "mode": "diff",                // "strict" | "diff"
  "divergences": [
    {
      "kind": "mismatched_call", // | "unexpected_call" | "unconsumed_events"
      "message": "tool_call \"search\" was called with different args",
      "expectedId": "tool_call:9c1e22aa:0",
      "actualSeq": 4
    }
  ]
}
```

## Versioning

`version` is bumped for any change an older reader could misinterpret.
Adding optional fields does not bump the version. Readers must reject
versions they do not know.
