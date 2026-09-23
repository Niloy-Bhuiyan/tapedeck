# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
