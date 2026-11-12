import { BUN_RELEASES } from "@scripts/sandbox/model/bun-release";
import { DEBIAN_WORKDIR } from "@scripts/sandbox/model/debian-config";
import { formatElapsed } from "@scripts/sandbox/model/readiness";
import type { NativePlatform, SandboxOs, SuitePlan } from "@scripts/sandbox/types/sandbox";

/** The folders of the staged copy, uploaded side by side into the plan's `uploads` folder. */
export const SUITE_REPO = "repo";
export const SUITE_BUN = "bun";

/** The build of the native libraries, relative to the repo root: `manifest.json` and a folder per platform. */
export const NATIVE_BUILD = ".local/build/native";
export const NATIVE_MANIFEST = "manifest.json";

/**
 * An empty folder at the copy's root: tools that look for the git root (commitlint) find it
 * there, as in a checkout. No git history is copied.
 */
export const GIT_ROOT_MARKER = ".git";

/** How each system runs the suite: its Bun build, its native libraries, its shell and where the uploads land. */
export const SUITE_PLANS: Record<SandboxOs, SuitePlan> = {
  windows: {
    bun: BUN_RELEASES["windows-x64"],
    native: "win32-x64",
    shell: "powershell",
    uploads: "C:\\goop",
  },
  debian: {
    bun: BUN_RELEASES["linux-x64"],
    native: "linux-x64",
    shell: "bash",
    uploads: DEBIAN_WORKDIR,
  },
};

/**
 * The whole suite in the sandbox: the copied Bun first on PATH (the suite's scripts call `bun`),
 * GOOP_REQUIRE_NATIVE=1 so the native tests fail instead of skipping without the libraries, then
 * `bun install --frozen-lockfile` and `bun run test` in the copy. The first failing step's exit
 * code is the command's exit code.
 */
export function suiteCommand(plan: SuitePlan): string {
  if (plan.shell === "powershell") {
    return [
      `$env:Path = '${plan.uploads}\\${SUITE_BUN};' + $env:Path`,
      "$env:GOOP_REQUIRE_NATIVE = '1'",
      `Set-Location ${plan.uploads}\\${SUITE_REPO}`,
      "bun install --frozen-lockfile",
      "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
      "bun run test",
      "exit $LASTEXITCODE",
    ].join("; ");
  }
  return [
    `export PATH="${plan.uploads}/${SUITE_BUN}:$PATH"`,
    "export GOOP_REQUIRE_NATIVE=1",
    `cd ${plan.uploads}/${SUITE_REPO}`,
    "bun install --frozen-lockfile",
    "bun run test",
  ].join(" && ");
}

/**
 * The files of the copy: tracked ones and untracked ones git does not ignore, as in the working
 * tree, so uncommitted work is tested too and .local/, .temp/ and node_modules/ never are.
 */
export function repoFilesArgs(root: string): string[] {
  return ["git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"];
}

/** Reads `git ls-files -z`: each name once, sorted. */
export function repoFiles(output: string): string[] {
  return [...new Set(output.split("\0").filter((name) => name !== ""))].sort();
}

/** The stop when the plan's native libraries are not built: the suite never skips them. */
export function missingNativeLibraries(platform: NativePlatform): string {
  return `No native libraries for ${platform}: run \`bun run build:native --target ${platform}\` first.`;
}

export function suiteSummary(os: SandboxOs, exitCode: number, elapsedMs: number): string {
  const elapsed = formatElapsed(elapsedMs);
  return exitCode === 0
    ? `The whole suite passed on ${os} in ${elapsed}.`
    : `The suite failed on ${os} with exit code ${exitCode} after ${elapsed}.`;
}
