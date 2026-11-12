// `bun run build` (odd/tasks/native-library.md, S6): compiles the single goop executable into
// dist/ with the host platform's native libraries and their manifest embedded, after checking
// them against the manifest. Without `bun run build:native` first, it builds nothing.
// Usage: bun scripts/build/cli.ts

import { bunCompiler } from "@scripts/build/adapters/compiler";
import { defaultBuild, parseBuildArgs, USAGE } from "@scripts/build/model/build";
import { buildExecutable } from "@scripts/build/services/build";
import { terminalOutput } from "@scripts/shared/containers";
import { repoRoot } from "@scripts/shared/repo-root";
import { builtNativeLibrary, NativeLibraryError, nativePlatform } from "@/shared/vault";

const command = parseBuildArgs(process.argv.slice(2));
if (command.kind === "usage") {
  process.stderr.write(`${command.error}\n${USAGE}`);
  process.exit(2);
}

let platform: ReturnType<typeof nativePlatform>;
try {
  platform = nativePlatform(process.platform, process.arch);
} catch (error) {
  if (!(error instanceof NativeLibraryError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

const root = repoRoot();
const exitCode = await buildExecutable(
  { verify: builtNativeLibrary, compiler: bunCompiler, output: terminalOutput },
  { root, platform, ...defaultBuild(root) },
);
process.exit(exitCode);
