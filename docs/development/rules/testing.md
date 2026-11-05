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

## Real systems

Code that talks to the operating system (TPM2, DPAPI, `bun:ffi`, systemd, native libraries) is checked on every system it runs on, never only with fakes. The steps follow the `sandbox-check` skill.
- Fakes first, test-first: they cover every branch on any machine.
- The whole suite runs on Linux and on Windows. CI does both on every pull request; locally, the host runs Linux and the Windows sandbox VM runs the Windows suite.
- Each OS-facing path also runs for real in a sandbox: the Debian container (Linux, no TPM2), the Debian VM with `swtpm` (TPM2), the Windows VM (DPAPI). Never on the maintainer's machine without consent.
- "It cannot be tested on Windows" is never an answer: a missing sandbox capability is a task to add, not a reason to skip.
- The plan Log records each real run: system, command and verbatim output (PASS/FAIL).

## Spikes

A spike answers one technical question in a timebox, with the least code that answers it. The workflow follows the `spikes` skill.
- The code lives only in `.temp/spikes/<name>/`. It is never committed or pushed, has no tests and no review, and is deleted when the spike ends.
- The deliverable is `docs/research/spike-<name>.md`, plus an ADR when it decides something and an entry in the plan Log.
- The code is gone, so the report holds the evidence: versions, pinned hashes, exact commands and verbatim outputs.
- Product code in `src/` is rewritten test-first. It is never copied from a spike.

## Quality evaluation

`eval/` measures whether goop chooses well (verdict accuracy, ranking quality) with real models and synthetic profiles. It is slow and run by hand when a prompt, model or retrieval setting changes. It never uses a real CV.
