import { writeSync } from "node:fs";
import type { EngineName, Output } from "@scripts/shared/containers/types/containers";

/** Synchronous writes keep our lines in order with the guest output streamed to the same fds. */
export const terminalOutput: Output = {
  info: (line) => {
    writeSync(1, `${line}\n`);
  },
  error: (line) => {
    writeSync(2, `${line}\n`);
  },
};

/** The container engines found on PATH (S3). */
export function installedEngines(): EngineName[] {
  return (["podman", "docker"] as const).filter((name) => Bun.which(name) !== null);
}
