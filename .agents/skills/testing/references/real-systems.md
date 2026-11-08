# Real systems

Three kinds of check, from the most automatic to the most real:

| Check                    | What it is                                                         | Leaves                       |
| ------------------------ | ------------------------------------------------------------------ | ---------------------------- |
| The suite on the host    | `bun run test`                                                     | Committed tests              |
| The suite on each system | `bun run sandbox:test windows` and `bun run sandbox:test debian`   | Counts in the pull request   |
| A probe on a real system | A throwaway program run in the sandbox against the real OS feature | Its verbatim output, no code |

## Where a probe runs

| The code touches                                 | Sandbox                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Linux without a TPM2 (systemd, files, sqlite3mc) | `bun run sandbox:run debian ...`                                             |
| Windows (DPAPI, `bun:ffi`, paths)                | `bun run sandbox:run windows ...`                                            |
| A TPM2 (`systemd-creds`, host+tpm2)              | None yet: report it as a missing capability; building it starts with a spike |

## Steps

1. Run the whole suite on each system: `bun run sandbox:test windows` and `bun run sandbox:test debian`; both exit 0. Explain each group of skipped tests (Linux-only by nature, native library not built, ...).
2. Write the smallest probe in `.temp/scratch/<name>/probe.ts`: one `PASS` or `FAIL` line per check, exit 1 on any failure.
3. Compile it: `bun scripts/dev-env/run.ts bun build --compile --target=bun-linux-x64|bun-windows-x64 <probe.ts> --outfile <probe>`.
4. Run it: `bun run sandbox:run <system> --copy <probe> --fetch <result path> -- '<run the probe>'`.
5. After a host reboot, if Podman reports a changed boot ID, delete `.temp/containers/run` and `.temp/containers/tmp` and run again.
6. Keep the verbatim output in `.temp/scratch/<name>/` until the pull request exists; then put it in its _How it was verified_ and delete the probe and its fetched results.
7. Check the pull request's CI on `ubuntu-latest` and `windows-latest`.
