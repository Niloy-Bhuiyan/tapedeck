# Example: research agent

A small tool-calling agent used as TapeDeck's demo and as this repo's own
end-to-end test fixture.

It answers questions like *"What is the combined population of Tokyo and
Delhi, and how many people per square kilometre is that?"* by:

1. asking the model what to do (OpenAI chat completions with tools),
2. calling `web_search` for each city (**mocked** — a tiny canned index),
3. calling `calculator` (a real, `eval`-free arithmetic parser),
4. asking the model for the final one-sentence answer.

It also reads the clock (`Date.now()`, `new Date()`) and draws a random run
ID (`Math.random()`), so the tape shows all five event types.

| File | What it is |
| ---- | ---------- |
| [`agent.ts`](agent.ts) | The agent loop. Plain OpenAI tool calling, nothing TapeDeck-specific. |
| [`tools.ts`](tools.ts) | `web_search` (mock) and `calculator`, wrapped with `tool()`. |
| [`client.ts`](client.ts) | Real `OpenAI` client when `OPENAI_API_KEY` is set, otherwise `MockOpenAI`. |
| [`mock-brain.ts`](mock-brain.ts) | The mock model's deterministic "reasoning". |
| [`main.ts`](main.ts) | CLI entry point. `--variant=v2` enables a deliberate regression. |
| [`tapes/research-agent.tape.json`](tapes/research-agent.tape.json) | The pre-recorded tape. |

## Try it

From the repository root:

```bash
npm run example             # run the agent live (offline via the mock brain)
npm run example:record      # re-record the tape
npm run example:replay      # replay the tape against the current code → match
npm run example:regression  # replay against the v2 "refactor" → diverges at step 8
```

Or use the CLI directly:

```bash
npx tsx src/cli/bin.ts replay examples/research-agent/tapes/research-agent.tape.json
```

## The regression

`--variant=v2` changes how search results are shown to the model (bullet
points instead of JSON). The final answer happens to stay the same, but the
model is now being prompted differently — exactly the kind of silent change
that should be reviewed. TapeDeck reports it as:

```
Tapes diverge at step 8 of 12.
Step 8: LLM call (openai chat.completions.create) was sent a different request:
  - request.messages[3].content: "[{\"title\":\"Tokyo – population and area\"… → "- Tokyo metropolis: population 14,094,034; area 2,194 km²."
```

## Using a real model

Set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, default `gpt-4.1-mini`)
and run `npm run example:record` to record a tape against the real API.
Replaying that tape is still free: replay never calls the API. Note that a
real model's answers differ from the mock brain's, so re-record the tape
after switching.
