import type { SandboxOs, SuitePlan } from "../types/sandbox";
import { BUN_RELEASES } from "./bun-release";
import { DEBIAN_WORKDIR } from "./debian-config";
import { formatElapsed } from "./readiness";

/** The folders of the staged copy, uploaded side by side into the plan's `uploads` folder. */
export const SUITE_REPO = "repo";
export const SUITE_BUN = "bun";

/**
 * An empty folder at the copy's root: tools that look for the git root (commitlint) find it
 * there, as in a checkout. No git history is copied.
 */
export const GIT_ROOT_MARKER = ".git";

/** How each system runs the suite: its Bun build, its shell and where the uploads land. */
export const SUITE_PLANS: Record<SandboxOs, SuitePlan> = {
  windows: { bun: BUN_RELEASES["windows-x64"], shell: "powershell", uploads: "C:\\goop" },
  debian: { bun: BUN_RELEASES["linux-x64"], shell: "bash", uploads: DEBIAN_WORKDIR },
};

/**
 * The whole suite in the sandbox: the copied Bun first on PATH (the suite's scripts call `bun`),
 * then `bun install --frozen-lockfile` and `bun run test` in the copy. The first failing step's
 * exit code is the command's exit code.
 */
export function suiteCommand(plan: SuitePlan): string {
  if (plan.shell === "powershell") {
    return [
      `$env:Path = '${plan.uploads}\\${SUITE_BUN};' + $env:Path`,
      `Set-Location ${plan.uploads}\\${SUITE_REPO}`,
      "bun install --frozen-lockfile",
      "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
      "bun run test",
      "exit $LASTEXITCODE",
    ].join("; ");
  }
  return [
    `export PATH="${plan.uploads}/${SUITE_BUN}:$PATH"`,
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

export function suiteSummary(os: SandboxOs, exitCode: number, elapsedMs: number): string {
  const elapsed = formatElapsed(elapsedMs);
  return exitCode === 0
    ? `The whole suite passed on ${os} in ${elapsed}.`
    : `The suite failed on ${os} with exit code ${exitCode} after ${elapsed}.`;
}
