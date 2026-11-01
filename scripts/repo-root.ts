import { resolve } from "node:path";

/**
 * The repository root. `GOOP_REPO_ROOT` overrides it so tests can run the
 * scripts against a fixture folder instead of the real repo.
 */
export function repoRoot(): string {
  return process.env.GOOP_REPO_ROOT ?? resolve(import.meta.dir, "..");
}
