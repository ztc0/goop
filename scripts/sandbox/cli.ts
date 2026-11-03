// Sandbox (S1, S2, S3, S5): for windows, installs Windows once into .local/windows/base/
// with dockur in Podman, then runs PowerShell commands in throwaway VMs over that base.
// For debian, builds a Debian image with systemd, then runs shell commands in
// throwaway containers. Podman storage and every file stay inside the repo.
// The engine is --engine, else Podman, else Docker (S3); Docker is not supported yet.
// Usage: bun scripts/sandbox/cli.ts install|status <windows|debian> [--engine podman|docker]
//        bun scripts/sandbox/cli.ts run <windows|debian> [--copy p] [--fetch p] [--] <command>
//        bun scripts/sandbox/cli.ts run debian [--copy p] [--fetch p]  (an interactive shell)
import { repoRoot } from "../shared/repo-root";
import { nodeFileStore } from "./adapters/file-store";
import { createGuestShell } from "./adapters/guest-shell";
import { createPodmanEngine } from "./adapters/podman";
import { bunProcessRunner } from "./adapters/process-runner";
import { cryptoRandom, installedEngines, systemClock, terminalOutput } from "./adapters/system";
import { parseCliArgs, USAGE } from "./model/cli-args";
import { chooseEngine } from "./model/engine-choice";
import { sandboxPaths } from "./model/paths";
import { passwordFromBytes, runId } from "./model/vm-config";
import { installDebian, runInDebian, showDebianStatus } from "./services/debian";
import { installWindows } from "./services/install";
import { runInWindows } from "./services/run";
import { showStatus } from "./services/status";
import type { SandboxDeps } from "./types/sandbox";

const command = parseCliArgs(process.argv.slice(2));
if (command.kind === "usage") {
  process.stderr.write(command.error === undefined ? USAGE : `${command.error}\n${USAGE}`);
  process.exit(2);
}
const choice = chooseEngine(command.engine, installedEngines());
if ("error" in choice) {
  process.stderr.write(`${choice.error}\n`);
  process.exit(1);
}
if (choice.warning !== undefined) process.stderr.write(`${choice.warning}\n`);
if (choice.engine === "docker") {
  process.stderr.write(
    "Docker is not supported yet; it arrives with the next change. Use --engine podman.\n",
  );
  process.exit(2);
}

// Ctrl+C aborts the wait or the command; the services still stop the sandbox and clean up.
const interrupt = new AbortController();
process.on("SIGINT", () => interrupt.abort());
process.on("SIGTERM", () => interrupt.abort());

const paths = sandboxPaths(repoRoot());
const deps: SandboxDeps = {
  paths,
  engine: createPodmanEngine(bunProcessRunner, paths),
  guest: createGuestShell(bunProcessRunner, paths),
  files: nodeFileStore,
  clock: systemClock,
  output: terminalOutput,
  random: cryptoRandom,
  signal: interrupt.signal,
  terminal: process.stdin.isTTY === true && process.stdout.isTTY === true,
};

const windows = command.os === "windows";
let exitCode: number;
switch (command.kind) {
  case "install":
    exitCode = await (windows ? installWindows(deps) : installDebian(deps));
    break;
  case "status":
    exitCode = await (windows ? showStatus(deps) : showDebianStatus(deps));
    break;
  case "run": {
    const id = runId(new Date(), passwordFromBytes(cryptoRandom.bytes(2)));
    exitCode = await (windows ? runInWindows(deps, command, id) : runInDebian(deps, command, id));
    break;
  }
}
process.exit(exitCode);
