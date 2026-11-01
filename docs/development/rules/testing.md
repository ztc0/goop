# Testing rules

## Test first

For behavior with a runnable deterministic test:
1. Write one failing test per requested rule.
2. Run it and confirm it fails for the right reason (RED).
3. Write the code that makes it pass (GREEN), then refactor with the tests green.

When a change touches existing shared code (options, parsers, helpers), add one test proving the previous behavior still holds.

## What a test asserts

- Every observable effect of the rule: exit code, exact stdout and stderr, files created or left untouched, stored data.
- The cases the rule names: its examples, boundaries and errors.
- Through the public interface (a script, a feature's `index.ts`, the IPC protocol), never internal storage.

## Where tests and fixtures live

- Feature tests: `src/<feature>/tests/unit/` and `src/<feature>/tests/integration/`.
- Cross-feature tests: `tests/integration/` and `tests/e2e/` at the root.
- Temporary files: a fresh folder under `.temp/tests/`, removed after the test. Never `/tmp`.

## Doubles instead of the outside world

| Dependency                        | In tests                                                             |
| --------------------------------- | -------------------------------------------------------------------- |
| Job APIs (Greenhouse, Ashby, ...) | Saved real JSON fixtures and a local fake server; never the internet |
| Model servers                     | A fake OpenAI-compatible server with fixed replies                   |
| SQLite and sqlite-vec             | A real temporary database                                            |
| TUI                               | The OpenTUI test renderer                                            |

## Quality evaluation

`eval/` measures whether goop chooses well (verdict accuracy, ranking quality) with real models and synthetic profiles. It is slow and run by hand when a prompt, model or retrieval setting changes. It never uses a real CV.
