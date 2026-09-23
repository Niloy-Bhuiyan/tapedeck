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
    "tapedeckVersion": "0.1.0",
    "command": "node agent.js",     // set by `tapedeck record -- <command>`
    "node": "v22.4.0",
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

A call to an LLM SDK method.

| Field        | Type    | Notes |
| ------------ | ------- | ----- |
| `provider`   | string  | `openai`, `anthropic`, `mock`, … |
| `operation`  | string  | SDK method path, e.g. `chat.completions.create`, `messages.create`. |
| `request`    | JSON    | The request body (first argument). Per-request options such as `signal` or `timeout` are not recorded. |
| `response`   | JSON    | The response object. For `stream: true` calls, the array of chunks. |
| `stream`     | boolean | Present and `true` for streamed calls. |
| `error`      | object  | `{ name, message, status?, code? }` when the call threw. Replay re-throws it. |
| `durationMs` | number  | Real latency during recording. |

ID inputs: `provider`, `operation`, `request`.

### `tool_call` / `tool_result`

A call to a function wrapped with `tool(name, fn)`, split into the call
(what the agent asked for) and the result (what it got back).

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

The code read the current time.

| Field    | Type   | Notes |
| -------- | ------ | ----- |
| `source` | string | `Date.now`, `new Date` (no arguments) or `Date()`. |
| `value`  | number | Epoch milliseconds returned to the code. |

### `random_draw`

The code called `Math.random()`.

| Field   | Type   | Notes |
| ------- | ------ | ----- |
| `value` | number | The value in `[0, 1)` returned to the code. |

## What is *not* captured

- Clock reads and random draws made **inside** an LLM SDK call or a wrapped
  tool. Those calls are replayed as a whole, so their internals never run
  on replay and must not appear on the tape.
- `performance.now()`, `crypto.randomUUID()`, `crypto.getRandomValues()`,
  file-system reads and raw `fetch` calls. Wrap such dependencies with
  `tool()` if the agent's behaviour depends on them.

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
