// Sandbox (S1, S3, S5): with --os windows, installs Windows once into .local/windows/base/
// with dockur in Podman, then runs PowerShell commands in throwaway VMs over that base.
// Podman storage and every file stay inside the repo. --os debian is not implemented yet.
// Usage: bun scripts/sandbox/cli.ts install | status | run [--copy p] [--fetch p] -- <command>
//        with --os windows|debian
import { repoRoot } from "../shared/repo-root";
import { nodeFileStore } from "./adapters/file-store";
import { createGuestShell } from "./adapters/guest-shell";
import { createPodman } from "./adapters/podman";
import { bunProcessRunner } from "./adapters/process-runner";
import { cryptoRandom, systemClock, terminalOutput } from "./adapters/system";
import { parseCliArgs, USAGE } from "./model/cli-args";
import { sandboxPaths } from "./model/paths";
import { passwordFromBytes, runId } from "./model/vm-config";
import { installWindows } from "./services/install";
import { runInWindows } from "./services/run";
import { showStatus } from "./services/status";
import type { SandboxDeps } from "./types/sandbox";

const command = parseCliArgs(process.argv.slice(2));
if (command.kind === "usage") {
  process.stderr.write(command.error === undefined ? USAGE : `${command.error}\n${USAGE}`);
  process.exit(2);
}
if (command.os !== "windows") {
  process.stderr.write(
    `--os ${command.os} is not implemented yet; only --os windows works for now.\n`,
  );
  process.exit(2);
}

// Ctrl+C aborts the wait or the guest command; the services still stop the VM and clean up.
const interrupt = new AbortController();
process.on("SIGINT", () => interrupt.abort());
process.on("SIGTERM", () => interrupt.abort());

const paths = sandboxPaths(repoRoot());
const deps: SandboxDeps = {
  paths,
  podman: createPodman(bunProcessRunner, paths),
  guest: createGuestShell(bunProcessRunner, paths),
  files: nodeFileStore,
  clock: systemClock,
  output: terminalOutput,
  random: cryptoRandom,
  signal: interrupt.signal,
};

let exitCode: number;
switch (command.kind) {
  case "install":
    exitCode = await installWindows(deps);
    break;
  case "status":
    exitCode = await showStatus(deps);
    break;
  case "run":
    exitCode = await runInWindows(
      deps,
      command,
      runId(new Date(), passwordFromBytes(cryptoRandom.bytes(2))),
    );
    break;
}
process.exit(exitCode);
