import { join, relative } from "node:path";
import type { SandboxPaths } from "../types/sandbox";

/** Every path the sandboxes use, from the repo root: nothing lives outside it (S3). */
export function sandboxPaths(root: string): SandboxPaths {
  const local = join(root, ".local");
  const windows = join(local, "windows");
  const base = join(windows, "base");
  const ssh = join(windows, "ssh");
  const temp = join(root, ".temp", "windows");
  return {
    root,
    containerStorage: join(local, "containers", "storage"),
    containerRunRoot: join(root, ".temp", "containers", "run"),
    containerTmp: join(root, ".temp", "containers", "tmp"),
    windows,
    base,
    baseDisk: join(base, "data.qcow2"),
    oem: join(windows, "oem"),
    ssh,
    sshKey: join(ssh, "id_ed25519"),
    sshPublicKey: join(ssh, "id_ed25519.pub"),
    password: join(windows, "password"),
    temp,
    knownHosts: join(temp, "known_hosts"),
    runs: join(temp, "runs"),
    results: join(temp, "results"),
    debianContainerfile: join(root, "scripts", "sandbox", "debian", "Containerfile"),
    debianResults: join(root, ".temp", "debian", "results"),
  };
}

/** The throwaway storage of one run, deleted when the run ends (S5). */
export function runDirectory(paths: SandboxPaths, runId: string): string {
  return join(paths.runs, runId);
}

export function resultsDirectory(paths: SandboxPaths, runId: string): string {
  return join(paths.results, runId);
}

/** A folder as shown to the user: relative to the repo root, with a trailing slash. */
export function displayPath(paths: SandboxPaths, directory: string): string {
  return `${relative(paths.root, directory)}/`;
}
