import type { EngineName } from "@scripts/shared/containers/types/containers";

export type EngineChoice = { engine: EngineName; warning?: string } | { error: string };

export const DOCKER_WARNING =
  "Using Docker: its images and containers live in Docker's own storage (usually /var/lib/docker), outside this repository.";

/**
 * The container engine (S3): `--engine` when given, else Podman when installed (it keeps
 * everything under .local/), else Docker with a warning that its storage is outside the repo.
 */
export function chooseEngine(
  requested: EngineName | undefined,
  installed: readonly EngineName[],
): EngineChoice {
  if (requested !== undefined && !installed.includes(requested)) {
    return { error: `--engine ${requested} was requested, but ${requested} is not installed.` };
  }
  const engine = requested ?? (installed.includes("podman") ? "podman" : installed[0]);
  if (engine === undefined) {
    return { error: "No container engine found. Install Podman (recommended) or Docker." };
  }
  return engine === "docker" ? { engine, warning: DOCKER_WARNING } : { engine };
}
