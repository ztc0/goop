// Sandbox (S1, S2, S3, S5): for windows, installs Windows once into .local/windows/base/
// with dockur in a container, then runs PowerShell commands in throwaway VMs over that base.
// For debian, builds a Debian image with systemd, then runs shell commands in
// throwaway containers. Podman storage and every file stay inside the repo.
// `test` runs the whole suite in either, with a pinned, hash-checked Bun (T8).
// The engine is --engine, else Podman, else Docker with a storage warning (S3, S4).
// Usage: bun scripts/sandbox/cli.ts install|status|test <windows|debian> [--engine podman|docker]
//        bun scripts/sandbox/cli.ts run <windows|debian> [--copy p] [--fetch p] [--] <command>
//        bun scripts/sandbox/cli.ts run debian [--copy p] [--fetch p]  (an interactive shell)
import {
  bunProcessRunner,
  chooseEngine,
  installedEngines,
  terminalOutput,
} from "../shared/containers";
import { downloadBytes } from "../shared/download";
import { repoRoot } from "../shared/repo-root";
import { createDockerEngine } from "./adapters/docker";
import { nodeFileStore } from "./adapters/file-store";
import { createGuestShell } from "./adapters/guest-shell";
import { createPodmanEngine } from "./adapters/podman";
import { cryptoRandom, systemClock } from "./adapters/system";
import { parseCliArgs, USAGE } from "./model/cli-args";
import { sandboxPaths } from "./model/paths";
import { passwordFromBytes, runId } from "./model/vm-config";
import { installDebian, runInDebian, showDebianStatus } from "./services/debian";
import { installWindows } from "./services/install";
import { runInWindows } from "./services/run";
import { showStatus } from "./services/status";
import { runSuite } from "./services/suite";
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

// Ctrl+C aborts the wait or the command; the services still stop the sandbox and clean up.
const interrupt = new AbortController();
process.on("SIGINT", () => interrupt.abort());
process.on("SIGTERM", () => interrupt.abort());

const paths = sandboxPaths(repoRoot());
const deps: SandboxDeps = {
  paths,
  engine:
    choice.engine === "docker"
      ? createDockerEngine(bunProcessRunner, paths)
      : createPodmanEngine(bunProcessRunner, paths),
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
  case "test": {
    const id = runId(new Date(), passwordFromBytes(cryptoRandom.bytes(2)));
    const suite = { ...deps, runner: bunProcessRunner, download: downloadBytes };
    exitCode = await runSuite(suite, command.os, id);
    break;
  }
}
process.exit(exitCode);
