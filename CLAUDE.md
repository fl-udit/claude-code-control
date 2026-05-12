# Claude Mission Control — Development Guide

## Test-Driven Development

This project follows TDD. **Tests must be written before or alongside implementation, and must pass locally before any push.**

### Workflow for every change

1. **Write the test first.** Before implementing a feature or fix, add a test in `tests/api/` or `tests/ui/` that describes the expected behavior. The test should fail at this point.
2. **Implement until the test passes.** Make the minimum change needed to satisfy the test.
3. **Run the full suite locally.** All 65+ tests must pass — no regressions.
4. **Then push.**

### Running tests

```bash
# Run full suite (starts isolated test server on port 3001 automatically)
npm test

# Interactive UI mode for debugging
npm run test:ui

# Run a single spec file
npx playwright test tests/api/browse.spec.js
```

The test server uses `DATA_DIR=/tmp/mmc-test` and `PORT=3001` (see `playwright.config.js`) — it is fully isolated from your real session data.

### Where tests live

| Directory | What to test |
|-----------|-------------|
| `tests/api/` | Every API endpoint: happy path, error cases, edge cases |
| `tests/ui/` | User-facing flows: modal open/close, form validation, keyboard shortcuts |

### Test naming convention

- API tests: describe the HTTP contract — method, path, and what varies (`returns 400 for non-existent path`)
- UI tests: describe user actions and observable outcomes (`Cancel closes modal without changing input`)

### What requires a test

- Every new API endpoint or change to an existing endpoint's behavior
- Every new UI feature (modal, button, keyboard shortcut, form)
- Every bug fix — add a regression test that would have caught the bug

### What does not require a test

- Pure CSS/styling changes with no behavior
- Refactors that preserve existing behavior already covered by tests

## Architecture

- **Server**: Express + node-pty (`server/`) — spawns and manages Claude CLI sessions
- **Client**: Vanilla JS + xterm.js (`client/`) — terminal UI, no build step
- **Storage**: JSON files in `~/.claude-code-control/` (env-overridable via `DATA_DIR`)
- **Tests**: Playwright (`tests/`) — API tests use `request` fixture, UI tests use `page`

## Key conventions

- `DATA_DIR` env var overrides the storage directory — always use it in tests
- Terminal fit (`fitAddon.fit()`) must run inside `requestAnimationFrame`, never synchronously, to avoid measuring an unpainted container
- PTY input uses `\r` (carriage return) for Enter, not `\n`
- Browse modal z-index is 140 (above template editor at 130, palette at 120, new-session modal at 100)
- The `/api/browse` endpoint returns 400 for non-existent paths — callers handle fallback
