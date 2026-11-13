// The dev container (S7, S11): the goop daemon as its main process, the repo mounted at the
// same path so goop's repo checks hold, and goop's data in .temp/dev/home/.
import { join } from "node:path";
import type { DevPaths } from "@scripts/dev/types/dev";
import { execArgs, type ProcessResult } from "@scripts/shared/containers";

/** Bump the tag whenever scripts/dev/Containerfile changes, so the next start rebuilds it. */
export const IMAGE = "localhost/goop-dev:1";
export const CONTAINER = "goop-dev";

/** The socket folder: private to the container, never on the mount. */
export const RUNTIME_DIR = "/tmp/goop-run";
const SOCKET = `${RUNTIME_DIR}/goop.sock`;

/** Host folders the container mounts or writes to, created before it starts. */
export function hostFolders(paths: DevPaths): string[] {
  return [paths.nodeModules, paths.devTemp, paths.tmp];
}

/**
 * Starts the container detached. No capabilities, no privilege gain, and an init so Ctrl+C
 * and `dev:stop` reach bun. `user` is Docker's host user; rootless Podman maps its root to the
 * host user already, so it needs none.
 */
export function startArgs(paths: DevPaths, user?: string): string[] {
  const env: Record<string, string> = {
    GOOP_HOME: paths.home,
    GOOP_RUNTIME_DIR: RUNTIME_DIR,
    BUN_INSTALL_CACHE_DIR: paths.bunCache,
    TMPDIR: paths.tmp,
    HOME: "/tmp",
  };
  return [
    "run",
    "-d",
    "--name",
    CONTAINER,
    "--init",
    "--cap-drop=all",
    "--security-opt=no-new-privileges",
    "--tmpfs",
    "/tmp",
    "-v",
    `${paths.root}:${paths.root}`,
    "-v",
    `${paths.nodeModules}:${join(paths.root, "node_modules")}`,
    "--workdir",
    paths.root,
    ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    ...(user === undefined ? [] : ["--user", user]),
    IMAGE,
    "bash",
    paths.entrypoint,
  ];
}

export function runningArgs(): string[] {
  return ["container", "inspect", "--format", "{{.State.Running}}", CONTAINER];
}

/** True only when the container exists and runs. */
export function isRunning(result: ProcessResult): boolean {
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

export function forceRemoveArgs(): string[] {
  return ["rm", "--force", CONTAINER];
}

export function followLogsArgs(): string[] {
  return ["logs", "--follow", CONTAINER];
}

export function socketCheckArgs(): string[] {
  return execArgs(CONTAINER, ["test", "-S", SOCKET]);
}

/**
 * goop from source, its arguments unchanged. `-i` always keeps stdin attached, so piped input
 * (`echo x | bun run dev`) reaches goop; `-t` gives it a terminal only when there is one.
 */
export function goopArgs(paths: DevPaths, args: readonly string[], terminal: boolean): string[] {
  return [
    "exec",
    terminal ? "-it" : "-i",
    "--workdir",
    paths.root,
    CONTAINER,
    "bun",
    "--no-env-file",
    "src/main.ts",
    ...args,
  ];
}
