// Native build (odd/tasks/storage.md, T5, S8): compiles libsqlite3mc.so for linux-x64 in a
// fresh container from the sandbox's pinned Debian image, through the sandbox's engine choice
// (Podman with repo-local storage, else Docker), and writes .local/build/native/.
// Usage: bun scripts/native/build.ts [--engine podman|docker]

import { bunProcessRunner } from "../sandbox/adapters/process-runner";
import { installedEngines, terminalOutput } from "../sandbox/adapters/system";
import { chooseEngine } from "../sandbox/model/engine-choice";
import { sandboxPaths } from "../sandbox/model/paths";
import { repoRoot } from "../shared/repo-root";
import { downloadBytes } from "./adapters/download";
import { nodeNativeFiles } from "./adapters/files";
import { parseBuildArgs, USAGE } from "./model/cli-args";
import { buildEngine } from "./model/compile";
import { SQLITE3MC_ARCHIVE } from "./model/inputs";
import { nativePaths } from "./model/paths";
import { buildNative } from "./services/build";

const command = parseBuildArgs(process.argv.slice(2));
if ("error" in command) {
  process.stderr.write(`${command.error}\n${USAGE}`);
  process.exit(2);
}
if (process.platform !== "linux" || process.arch !== "x64") {
  process.stderr.write("native:build runs on Linux x86_64 only.\n");
  process.exit(1);
}
const choice = chooseEngine(command.engine, installedEngines());
if ("error" in choice) {
  process.stderr.write(`${choice.error}\n`);
  process.exit(1);
}
if (choice.warning !== undefined) process.stderr.write(`${choice.warning}\n`);

const root = repoRoot();
const uid = process.getuid?.() ?? 0;
const gid = process.getgid?.() ?? 0;
const exitCode = await buildNative(
  {
    paths: nativePaths(root),
    engine: buildEngine(choice.engine, sandboxPaths(root), uid, gid),
    runner: bunProcessRunner,
    files: nodeNativeFiles,
    download: downloadBytes,
    now: () => Date.now(),
    output: terminalOutput,
  },
  SQLITE3MC_ARCHIVE,
);
process.exit(exitCode);
