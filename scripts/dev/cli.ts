// `bun run dev [goop args]`, `bun run dev:logs`, `bun run dev:stop` (dev-sandbox S7, S11):
// goop from source in a light container, the daemon as its main process restarted on every
// source change, goop's data in .temp/dev/home/. No .env: every variable is set here.
// The engine is Podman when installed (storage in the repo), else Docker with a warning;
// there is no --engine flag, since every argument after `dev` belongs to goop.
// Usage: bun scripts/dev/cli.ts goop [args...] | logs | stop

import { createDevEngine } from "@scripts/dev/adapters/engine";
import { nodeFolders, systemClock } from "@scripts/dev/adapters/system";
import { parseCliArgs, USAGE } from "@scripts/dev/model/cli-args";
import { devPaths } from "@scripts/dev/model/paths";
import { followLogs, runGoop, stopDev } from "@scripts/dev/services/dev";
import type { DevDeps } from "@scripts/dev/types/dev";
import {
  bunProcessRunner,
  chooseEngine,
  installedEngines,
  terminalOutput,
} from "@scripts/shared/containers";
import { repoRoot } from "@scripts/shared/repo-root";

const command = parseCliArgs(process.argv.slice(2));
if (command.kind === "usage") {
  process.stderr.write(command.error === undefined ? USAGE : `${command.error}\n${USAGE}`);
  process.exit(2);
}
const choice = chooseEngine(undefined, installedEngines());
if ("error" in choice) {
  process.stderr.write(`${choice.error}\n`);
  process.exit(1);
}
if (choice.warning !== undefined) process.stderr.write(`${choice.warning}\n`);

const paths = devPaths(repoRoot());
const deps: DevDeps = {
  paths,
  engine: createDevEngine(
    choice.engine,
    bunProcessRunner,
    paths,
    process.getuid?.() ?? 0,
    process.getgid?.() ?? 0,
  ),
  folders: nodeFolders,
  clock: systemClock,
  output: terminalOutput,
  terminal: process.stdin.isTTY === true && process.stdout.isTTY === true,
};

let exitCode: number;
switch (command.kind) {
  case "goop":
    exitCode = await runGoop(deps, command.args);
    break;
  case "logs":
    exitCode = await followLogs(deps);
    break;
  case "stop":
    exitCode = await stopDev(deps);
    break;
}
process.exit(exitCode);
