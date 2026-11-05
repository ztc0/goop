// Native libraries (odd/tasks/native-library.md, S1, S2): downloads each pinned library's
// source, checks it, builds it in a fresh container from a pinned image and checks the output
// against its pin, then writes .local/build/native/<platform>/ and its manifest.json.
// Usage: bun scripts/native-libs/cli.ts [<library>...] [--engine podman|docker] [--verify-signature]
import {
  bunProcessRunner,
  chooseEngine,
  installedEngines,
  terminalOutput,
} from "../shared/containers";
import { downloadBytes } from "../shared/download";
import { repoRoot } from "../shared/repo-root";
import { nodeFiles } from "./adapters/files";
import { parseBuildArgs, USAGE } from "./model/cli-args";
import { buildEngine } from "./model/engine";
import { nativeLibsPaths } from "./model/paths";
import { COSIGN } from "./model/signature";
import { buildLibrary } from "./services/build";
import { SQLITE3MC_LINUX } from "./sqlite3mc/recipe";
import type { BuildDeps, LibraryRecipe } from "./types/native-libs";

/** Each library and the platforms this script builds it for. */
const RECIPES: Record<string, readonly LibraryRecipe[]> = { sqlite3mc: [SQLITE3MC_LINUX] };

const command = parseBuildArgs(process.argv.slice(2), Object.keys(RECIPES));
if (command.kind === "help") {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (command.kind === "usage") {
  process.stderr.write(`${command.error}\n${USAGE}`);
  process.exit(2);
}
if (process.platform !== "linux" || process.arch !== "x64") {
  process.stderr.write("native-libs:build runs on Linux x86_64 only.\n");
  process.exit(1);
}
const choice = chooseEngine(command.engine, installedEngines());
if ("error" in choice) {
  process.stderr.write(`${choice.error}\n`);
  process.exit(1);
}
if (choice.warning !== undefined) process.stderr.write(`${choice.warning}\n`);

const paths = nativeLibsPaths(repoRoot());
const deps: BuildDeps = {
  paths,
  engine: buildEngine(
    choice.engine,
    paths.podman,
    process.getuid?.() ?? 0,
    process.getgid?.() ?? 0,
  ),
  runner: bunProcessRunner,
  files: nodeFiles,
  download: downloadBytes,
  now: () => Date.now(),
  output: terminalOutput,
};
for (const library of command.libraries) {
  for (const recipe of RECIPES[library] ?? []) {
    const exitCode = await buildLibrary(deps, recipe, {
      verifySignature: command.verifySignature,
      cosign: COSIGN,
    });
    if (exitCode !== 0) process.exit(exitCode);
  }
}
