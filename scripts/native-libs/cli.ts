// Native libraries (odd/tasks/native-library.md, S1, S2, S3): downloads each pinned library's
// source, checks it, builds it for each target in a fresh container from a pinned image and
// checks every output against its pin, then writes .local/build/native/<platform>/ and its
// manifest.json.
// Usage: bun scripts/native-libs/cli.ts [<library>...] [--target linux-x64|win32-x64]
//   [--engine podman|docker] [--verify-signature]

import { nodeFiles } from "@scripts/native-libs/adapters/files";
import { parseBuildArgs, USAGE } from "@scripts/native-libs/model/cli-args";
import { buildEngine } from "@scripts/native-libs/model/engine";
import { nativeLibsPaths } from "@scripts/native-libs/model/paths";
import { COSIGN } from "@scripts/native-libs/model/signature";
import { buildLibrary } from "@scripts/native-libs/services/build";
import { SQLITE3MC_LINUX, SQLITE3MC_WIN32 } from "@scripts/native-libs/sqlite3mc/recipe";
import type { BuildDeps, LibraryRecipe } from "@scripts/native-libs/types/native-libs";
import {
  bunProcessRunner,
  chooseEngine,
  installedEngines,
  terminalOutput,
} from "@scripts/shared/containers";
import { downloadBytes } from "@scripts/shared/download";
import { repoRoot } from "@scripts/shared/repo-root";

/** Each library and the platforms this script builds it for. */
const RECIPES: Record<string, readonly LibraryRecipe[]> = {
  sqlite3mc: [SQLITE3MC_LINUX, SQLITE3MC_WIN32],
};

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
  process.stderr.write("build:native runs on Linux x86_64 only.\n");
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
const { target } = command;
for (const library of command.libraries) {
  const recipes = (RECIPES[library] ?? []).filter(
    (recipe) => target === undefined || recipe.platform === target,
  );
  const exitCode = await buildLibrary(deps, recipes, {
    verifySignature: command.verifySignature,
    cosign: COSIGN,
  });
  if (exitCode !== 0) process.exit(exitCode);
}
