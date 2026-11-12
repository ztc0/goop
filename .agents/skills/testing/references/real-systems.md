# Real systems

Three kinds of check, from the most automatic to the most real:

| Check                    | What it is                                                         | Leaves                       |
| ------------------------ | ------------------------------------------------------------------ | ---------------------------- |
| The suite on the host    | `bun run test`                                                     | Committed tests              |
| The suite on each system | `bun run sandbox test windows` and `bun run sandbox test debian`   | Counts in the pull request   |
| A probe on a real system | A throwaway program run in the sandbox against the real OS feature | Its verbatim output, no code |

## Where a probe runs

| The code touches                                 | Sandbox                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Linux without a TPM2 (systemd, files, sqlite3mc) | `bun run sandbox run debian ...`                                             |
| Windows (DPAPI, `bun:ffi`, paths)                | `bun run sandbox run windows ...`                                            |
| A TPM2 (`systemd-creds`, host+tpm2)              | None yet: report it as a missing capability; building it starts with a spike |

## Steps

1. Build the native libraries for both systems (`bun run build:native --target win32-x64` and `--target linux-x64`), then run the whole suite on each system: `bun run sandbox test windows` and `bun run sandbox test debian`; both exit 0. The suite copies in only the system's native libraries and the manifest, and the native tests never skip there. Explain each group of skipped tests (Linux-only by nature, ...).
2. Write the smallest probe in `.temp/scratch/<name>/probe.ts`: one `PASS` or `FAIL` line per check, exit 1 on any failure.
3. Compile it for the system it runs on, one of:

   ```bash
   bun scripts/dev-env/run.ts bun build --compile --target=bun-linux-x64 <probe.ts> --outfile <probe>
   bun scripts/dev-env/run.ts bun build --compile --target=bun-windows-x64 <probe.ts> --outfile <probe>.exe
   ```

4. Run it so it writes its output to a file in the sandbox, keeping its exit code, and fetch that file: `bun run sandbox run <system> --copy <probe> --fetch <result path> -- '<run the probe, writing its output to the result path>'`.
5. After a host reboot, if Podman reports a changed boot ID, delete `.temp/containers/run` and `.temp/containers/tmp` and run again.
6. Keep the verbatim output in `.temp/scratch/<name>/`. Steps 1 to 5 are the check before any pull request exists.
7. Once the maintainer asks for the pull request: put the output in its _How it was verified_, delete the probe and its fetched results, and check its CI on `ubuntu-latest` and `windows-latest`.
