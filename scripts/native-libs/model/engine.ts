import type { BuildEngine, LibraryRecipe } from "@scripts/native-libs/types/native-libs";
import {
  type EngineName,
  type PodmanStorage,
  podmanEnvironment,
  podmanGlobalArgs,
} from "@scripts/shared/containers";

/** Podman with its repo-local storage, or Docker run as the host user. */
export function buildEngine(
  name: EngineName,
  storage: PodmanStorage,
  uid: number,
  gid: number,
): BuildEngine {
  return name === "podman"
    ? {
        name,
        command: ["podman", ...podmanGlobalArgs(storage)],
        env: podmanEnvironment(storage),
        directories: [storage.containerStorage, storage.containerRunRoot, storage.containerTmp],
      }
    : { name, command: ["docker"], env: {}, directories: [], user: `${uid}:${gid}` };
}

export interface BuildDirectories {
  /** Holds only the verified archive; mounted read-only. */
  download: string;
  /** Receives the extracted source. */
  extract: string;
  /** Receives the library and the toolchain list. */
  out: string;
}

/** A throwaway container with no network, no capabilities and a read-only root file system. */
export function runArgs(
  engine: BuildEngine,
  recipe: Pick<LibraryRecipe, "image" | "environment" | "script">,
  dirs: BuildDirectories,
): string[] {
  return [
    "run",
    "--rm",
    "--network=none",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--cap-drop=all",
    ...Object.entries(recipe.environment).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    "-v",
    `${dirs.download}:/build/input:ro`,
    "-v",
    `${dirs.extract}:/build/src`,
    "-v",
    `${dirs.out}:/build/out`,
    ...(engine.user === undefined ? [] : ["--user", engine.user]),
    recipe.image,
    "sh",
    "-c",
    recipe.script,
  ];
}
