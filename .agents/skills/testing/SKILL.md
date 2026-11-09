---

name: testing
description: "Trigger: test, tests, test first, TDD, RED, testear, probar, test on Windows, probar en windows, probar en linux, sandbox, real run, e2e, TPM, DPAPI, bun:ffi. Test a goop change test-first at the right level, from unit tests to real runs on Windows and Linux."
license: GPL-3.0-only
metadata: { author: ztc0, version: "1.0" }
---

## Activation Contract

Use for every change with behavior to test, before calling it done or opening its pull request.
This skill is the procedure; the rules live in `docs/development/rules/testing.md` (test first, what a test asserts, where tests and fixtures live, the doubles, real systems). When they disagree, `testing.md` wins.

## Hard Rules

- See RED fail for the right reason before writing the code; never assume it.
- Never run real OS-key-store code on the maintainer's machine without consent naming the exact path it touches.

## Decision Gates

| What changed                                                                 | Level                                 | How                          |
| ---------------------------------------------------------------------------- | ------------------------------------- | ---------------------------- |
| Pure logic (`model/`)                                                        | Unit                                  | `bun run test`               |
| Adapters, SQLite, files, a CLI                                               | Integration                           | `bun run test`               |
| A whole user flow through the TUI and the daemon                             | E2E in `tests/e2e/` (none yet)        | `bun run test`               |
| Code that talks to the OS: TPM2, DPAPI, `bun:ffi`, systemd, native libraries | The suite on every system, a real run | `references/real-systems.md` |

## Execution Steps

1. Write the failing test at the level the table gives; run it and read why it fails.
2. Make it pass, then refactor with the tests green.
3. `bun run lint`, `bun run typecheck` and `bun run test`; all exit 0.
4. For OS-facing code, follow `references/real-systems.md`.

## Output Contract

Each test added with its RED reason; the suite counts; for OS-facing code, the counts per system with each skipped group and its reason, and each real run verbatim.

## References

- `docs/development/rules/testing.md`: the rules.
- `references/real-systems.md`: the suite on Windows and Debian, and real runs in the sandbox.
- `docs/development/sandbox.md`: the `sandbox:*` commands and their limits.
