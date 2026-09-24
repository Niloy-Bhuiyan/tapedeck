# Running TapeDeck in GitHub Actions

`tapedeck test` replays every tape in your repository against the command it
was recorded with — offline, with no API keys — and exits non-zero if any
agent run changed. The bundled action wraps it with pull-request niceties.

## With the action

```yaml
# .github/workflows/agent-regressions.yml
name: Agent regressions
on: [pull_request]

permissions:
  contents: read
  pull-requests: write # for the summary comment

jobs:
  tapes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci # tapedeck is a devDependency of your project
      - uses: Niloy-Bhuiyan/tapedeck@main
        with:
          paths: tapes
```

When a tape diverges the job:

- fails, with an inline **annotation** on the tape file in the PR's *Files* view,
- writes a **job summary** table (✅/❌ per tape, with the first point of divergence),
- posts or updates one **PR comment** with the same summary,
- uploads an HTML **diff report** per failing tape as the `tapedeck-reports` artifact.

| Input | Default | Meaning |
| ----- | ------- | ------- |
| `paths` | `.` | Files or directories to search for tapes. |
| `args` | | Extra `tapedeck test` arguments, e.g. `--ignore clock_read`. |
| `comment` | `true` | Comment on the PR when tapes diverge. |
| `report-dir` | `tapedeck-reports` | Where HTML diff reports are written. |
| `github-token` | `github.token` | Token for the PR comment. |

## Without the action

`tapedeck test` detects GitHub Actions by itself (job summary and
annotations), so a single step is enough:

```yaml
      - run: npx tapedeck test tapes
```

## When a change is intended

Re-record the affected tapes locally and commit them:

```bash
npx tapedeck test tapes --update
```

`--update` re-runs the changed tapes for real (this makes real API calls), so
it needs your API keys; normal `tapedeck test` runs never do.
