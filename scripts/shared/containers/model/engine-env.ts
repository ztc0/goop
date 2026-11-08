import type { PodmanStorage } from "@scripts/shared/containers/types/containers";

/** Global flags that keep images, containers and temporary files inside the repo (S3). */
export function podmanGlobalArgs(paths: PodmanStorage): string[] {
  return [
    "--root",
    paths.containerStorage,
    "--runroot",
    paths.containerRunRoot,
    "--tmpdir",
    paths.containerTmp,
  ];
}

/**
 * Environment of every podman call. The password travels here, read by `-e PASSWORD`,
 * so it never appears in argv.
 */
export function podmanEnvironment(paths: PodmanStorage, password?: string): Record<string, string> {
  return password === undefined
    ? { TMPDIR: paths.containerTmp }
    : { TMPDIR: paths.containerTmp, PASSWORD: password };
}

/**
 * Docker has no per-command storage flags: its images and containers go to the daemon's own
 * storage. The password travels in the environment, read by `-e PASSWORD`, so it never
 * appears in argv.
 */
export function dockerEnvironment(password?: string): Record<string, string> {
  return password === undefined ? {} : { PASSWORD: password };
}
