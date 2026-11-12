import { mkdirSync } from "node:fs";
import type { CallMode, DevEngine, DevPaths } from "@scripts/dev/types/dev";
import {
  type EngineName,
  type ProcessRunner,
  podmanEnvironment,
  podmanGlobalArgs,
} from "@scripts/shared/containers";

/**
 * Podman with its storage inside the repo (created before every call, since `bun run clean` may
 * delete .temp/ at any time), or Docker run as the host user.
 */
export function createDevEngine(
  name: EngineName,
  runner: ProcessRunner,
  paths: DevPaths,
  uid: number,
  gid: number,
): DevEngine {
  const modeOf = (mode: CallMode) =>
    mode === "stream" ? { stream: true } : mode === "interactive" ? { interactive: true } : {};
  if (name === "docker") {
    return {
      name,
      user: `${uid}:${gid}`,
      call: (args, mode = "capture") =>
        runner.run({ command: ["docker", ...args], ...modeOf(mode) }),
    };
  }
  return {
    name,
    call: (args, mode = "capture") => {
      for (const directory of [
        paths.containerStorage,
        paths.containerRunRoot,
        paths.containerTmp,
      ]) {
        mkdirSync(directory, { recursive: true });
      }
      return runner.run({
        command: ["podman", ...podmanGlobalArgs(paths), ...args],
        env: podmanEnvironment(paths),
        ...modeOf(mode),
      });
    },
  };
}
