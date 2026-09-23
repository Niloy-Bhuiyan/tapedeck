# Contributing to TapeDeck

Thanks for helping! TapeDeck is small on purpose: zero runtime dependencies,
strict TypeScript, and a test suite that runs fully offline.

## Getting started

```bash
git clone https://github.com/Niloy-Bhuiyan/tapedeck
cd tapedeck
npm install        # also builds dist/ via the prepare script
npm test           # vitest, fully offline, no API keys needed
npm run typecheck  # tsc --noEmit over src, tests and examples
```

Node.js 20.6+ is required. You never need API keys to develop: the example
and tests use the deterministic providers in `src/mock/`
(see [MOCKED_COMPONENTS.md](MOCKED_COMPONENTS.md)).

Handy while developing:

```bash
npm run tapedeck -- --help                # run the CLI from source
npm run example                           # run the example agent
npm run example:replay                    # replay its tape against the code
npx vitest tests/diff                     # run one area's tests in watch mode
```

## Project layout

| Path | What lives there |
| ---- | ---------------- |
| `src/tape/` | Tape format types, stable IDs, validation, JSON/JSONL I/O. |
| `src/runtime/` | Sessions (record/replay), async scoping, patched `Date`/`Math.random`, env activation. |
| `src/interceptors/` | `wrapOpenAI`, `wrapAnthropic`, `wrapClient`, `tool`. |
| `src/diff/` | Deep JSON diff and tape alignment. |
| `src/format/`, `src/report/` | Terminal and HTML rendering. |
| `src/cli/`, `src/process.ts` | The `tapedeck` command and child-process plumbing. |
| `src/testing/` | `replayTape`, `toMatchTape`, Vitest/Jest registration. |
| `src/mock/` | Deterministic fake providers (`// MOCK:`). |
| `examples/research-agent/` | Demo agent and its committed tape (also a test fixture). |
| `docs/tape-format.md` | The tape specification. |

[DESIGN_NOTES.md](DESIGN_NOTES.md) explains the main design decisions;
please read it before changing matching, scoping or the tape format.

## Making changes

1. Open an issue first for anything larger than a bug fix, especially
   changes to the tape format or public API.
2. Keep pull requests focused, and add or update tests. The core
   (`src/tape`, `src/runtime`, `src/diff`) must stay well covered.
3. Run `npm run typecheck && npm test` before pushing.
4. Update docs (`README.md`, `docs/tape-format.md`) when behaviour changes.

### Tape format changes

The format is versioned (`version: 1`). Adding an optional field is fine.
Anything an older reader could misinterpret needs a version bump, a
migration note in `docs/tape-format.md`, and a reader for the old version.

### If you change the example agent

`tests/example.test.ts` replays the committed tape against the example code.
If you intentionally change the agent's behaviour, re-record it with
`npm run example:record` and commit the new tape in the same PR.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, with an optional
scope, e.g. `feat(diff): align renamed tools`. Keep commits small and
self-contained.

## Code style

- TypeScript strict mode; no `any` in `src/` unless unavoidable and commented.
- Match the surrounding code: ESM imports with `.js` extensions, small
  functions, comments that explain *why*.
- No new runtime dependencies without discussion.

## Reporting bugs

Include your Node.js version, the SDK and version you wrap, and ideally a
tape that reproduces the problem (`tapedeck record -- …`). Remove any
secrets or personal data from tapes before sharing them: tapes contain full
LLM requests and responses.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
