---

name: sandbox-check
description: "Trigger: test on Windows, test on Linux, probar en windows, probar en linux, probar en vm, sandbox check, real run, TPM, DPAPI, bun:ffi. Run goop's checks on every system: the whole suite on Linux and Windows, and each OS-facing path for real in the sandbox."
license: GPL-3.0-only
metadata:
author: ztc0
version: "1.0"
---

## Activation Contract

Use after changing code that talks to the operating system (TPM2, DPAPI, `bun:ffi`, systemd, native libraries), and before calling it done or opening its pull request.
Not for pure logic with no OS access: the normal suite covers it.

## Hard Rules

- Never answer "it cannot be tested on Windows" (or Linux, or a TPM). A missing sandbox capability is a task to add; report it, never skip it silently.
- Fakes first, test-first; the sandbox adds evidence, it never replaces tests.
- Never run real OS-key-store code on the maintainer's machine without consent naming the exact path it touches.
- Probes live only in `.temp/scratch/<name>/`, are never committed, and are deleted after the run.
- Record each run in the pull request's _How it was verified_: system, command, verbatim PASS/FAIL lines.

## Decision Gates

| The code touches                                 | Where it runs for real                                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux without a TPM2 (systemd, files, sqlite3mc) | `bun run sandbox:run debian ...`                                                                                                                                                                        |
| A TPM2 (`systemd-creds`, host+tpm2)              | Debian VM with `swtpm` (UEFI, `libtss2`; sandbox T7)                                                                                                                                                    |
| Windows (DPAPI, `bun:ffi`, paths)                | `bun run sandbox:run windows ...`                                                                                                                                                                       |
| Anything                                         | The whole suite: host `bun run test`, `bun run sandbox:test windows` and `bun run sandbox:test debian` (sandbox T8, done), CI `ubuntu-latest` and `windows-latest`; Linux in a VM comes with sandbox T7 |

## Execution Steps

1. `bun run lint`, `bun run typecheck`, `bun run test` on the host; all exit 0.
2. The whole suite in the sandboxes: `bun run sandbox:test windows` and `bun run sandbox:test debian`; both exit 0. Explain every group of skipped tests (Linux-only by nature, native library not built, ...); a group skipped only because a sandbox lacks a tool is a named task, never a silent skip.
3. Write the smallest probe in `.temp/scratch/<name>/probe.ts` that prints one `PASS`/`FAIL` line per check and exits 1 on any failure.
4. Compile it: `bun scripts/dev-env/run.ts bun build --compile --target=bun-linux-x64|bun-windows-x64 <probe.ts> --outfile <probe>`.
5. Run it: `bun run sandbox:run <system> --copy <probe> --fetch <result path> -- '<run the probe>'` (see `docs/development/sandbox.md`).
6. After a host reboot, if Podman reports a changed boot ID, delete `.temp/containers/run` and `.temp/containers/tmp` and run again.
7. Read the verbatim output and keep it in `.temp/scratch/<name>/` until the pull request exists.
8. Push, open the pull request, put the output in its _How it was verified_, then delete the probe and its fetched results.
9. Check the pull request's CI on `ubuntu-latest` and `windows-latest`.

## Output Contract

Return: the host suite counts, the `sandbox:test` counts per system with each skipped group and its reason, each sandbox run (system, command, verbatim result), the CI result per job, and any sandbox capability still missing as a named task.

## References

- `docs/development/rules/testing.md` — the "Real systems" rule.
- `docs/development/sandbox.md` — sandbox commands and limits.
- `docs/research/spike-tpm-vm.md` — the `swtpm` VM recipe (UEFI and `libtss2` are both needed).
