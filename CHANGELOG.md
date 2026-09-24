# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-09-25

Zero-code recording: agents no longer need any TapeDeck code.

### Added

- **Network-level capture.** Calls to well-known LLM APIs made through
  `fetch` (OpenAI, Anthropic, Google, Mistral, Groq, OpenRouter, Azure
  OpenAI, …) are recorded and replayed without wrappers, so any client built
  on fetch works: official SDKs, Vercel AI SDK, LangChain.js. Streams replay
  byte-faithfully through the SDK's own parser; recorded rate-limit retries
  replay instantly. `--llm-host` adds hosts (e.g. Ollama) and
  `--http-host` records non-LLM APIs as tools.
- **Preload for unmodified programs.** `tapedeck record` and
  `replay --against` inject TapeDeck via `NODE_OPTIONS`.
- **`tapedeck test`**: replays every tape against its recorded command,
  with `--update` to re-record changed tapes, HTML reports for failures,
  and GitHub job summaries and annotations.
- **GitHub Action** (`uses: Niloy-Bhuiyan/tapedeck@main`) with PR comments.
- **Secret redaction** by default (API keys, tokens) plus `--redact`
  patterns; replay redacts live requests the same way before comparing.
- **`--ignore-path` / `ignorePaths`** with wildcards to ignore noisy fields
  in matching and diffs; saved on the tape when given at record time.
- Streamed text and tool calls shown in timelines and reports.
- Zero-code demo (`npm run example:zero-code`).

### Changed

- Only clock reads and random draws made by application code are recorded;
  reads inside `node_modules` (SDK retry jitter, loaders) run for real. Tapes
  are now stable across dependency upgrades.

## [0.1.0] - 2026-09-24

First release.

### Added

- Tape format v1 (`.tape.json` / `.tape.jsonl`) with `llm_call`,
  `tool_call`, `tool_result`, `clock_read` and `random_draw` events, stable
  content-derived event IDs, and validation.
- `record()` / `replay()` with async-scoped capture of LLM calls, tools,
  `Date` and `Math.random`; strict and diff replay modes; optional
  passthrough; faithful replay of recorded errors and streamed responses.
- `wrapOpenAI`, `wrapAnthropic`, `wrapClient` and `tool` interceptors,
  verified against the official `openai` and `@anthropic-ai/sdk` clients.
- Diff engine with LCS alignment, field-level changes and a plain-English
  first-divergence summary.
- `tapedeck` CLI: `record`, `replay`, `replay --against`, `diff`, `report`.
- Self-contained HTML reports for tapes and diffs.
- `replayTape()` and the `toMatchTape()` matcher for Vitest and Jest.
- `MockOpenAI` and `MockAnthropic` deterministic offline providers.
- Example research agent with a pre-recorded tape.
