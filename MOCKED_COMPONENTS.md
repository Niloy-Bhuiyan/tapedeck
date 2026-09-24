# Mocked components

TapeDeck was built without real provider API keys, so a few pieces are
deterministic fakes. Every one is marked in the source with a `// MOCK:`
comment (`grep -rn "MOCK:" src examples`). This file lists them and says what
to do once real keys are available.

**The core library is not mocked.** Recording, replay, diffing, the CLI, the
reporter and the test matchers are real, and `wrapOpenAI` / `wrapAnthropic`
are tested against the official `openai` and `@anthropic-ai/sdk` clients
(see `tests/sdk.test.ts`, which swaps only the network layer for a stub
`fetch`).

| Component | Where | What it fakes | Swap-in once keys exist |
| --------- | ----- | ------------- | ----------------------- |
| `MockOpenAI` | `src/mock/openai.ts` | `client.chat.completions.create` with canned `ChatCompletion` objects chosen by a responder function. No streaming. | `new OpenAI()` from `openai` (reads `OPENAI_API_KEY`). Wrap it the same way: `wrapOpenAI(new OpenAI())`. |
| `MockAnthropic` | `src/mock/anthropic.ts` | `client.messages.create` with canned `Message` objects. No streaming. | `new Anthropic()` from `@anthropic-ai/sdk` (reads `ANTHROPIC_API_KEY`). Wrap with `wrapAnthropic(...)`. |
| Mock reply types | `src/mock/reply.ts` | Shared `MockReply` / `MockResponder` types for the two mocks. | Nothing to swap; only used by the mocks. |
| Research-agent "brain" | `examples/research-agent/mock-brain.ts` | The model's decisions in the example: search each city, compute density, answer. | Nothing to change: `examples/research-agent/client.ts` already uses the real `OpenAI` client when `OPENAI_API_KEY` is set. Re-record the tape afterwards (`npm run example:record`), because a real model will word things differently. |
| Research-agent `web_search` | `examples/research-agent/tools.ts` (`MOCK_INDEX`) | A four-entry canned "web". | Replace the body of `webSearch` with a call to a real search API (Brave, Bing, Tavily, SerpAPI…). Keep the `tool('web_search', …)` wrapper so it is still recorded. |
| Fake OpenAI server | `examples/zero-code/fake-openai-server.ts` | An OpenAI-compatible `POST /v1/chat/completions` endpoint (streaming and not) that the zero-code demo points the untouched SDK at via `OPENAI_BASE_URL`. | Nothing to swap: with a real key, run `npx tapedeck record -- node examples/zero-code/agent.mjs` directly — calls to `api.openai.com` are recorded automatically. |

The mocks are also exported from the package (`MockOpenAI`, `MockAnthropic`)
because they are handy for users' own offline tests.

## Switching the example to real OpenAI

```bash
export OPENAI_API_KEY=sk-...
export OPENAI_MODEL=gpt-4.1-mini   # optional
npm run example                    # live run against the API
npm run example:record             # record a new tape (costs one run)
npm run example:replay             # replays are free: no API calls
```

The committed tape `examples/research-agent/tapes/research-agent.tape.json`
was recorded with the mock brain. `tests/example.test.ts` replays it, and
replay never touches the client, so the test suite keeps passing whether or
not a key is set.
