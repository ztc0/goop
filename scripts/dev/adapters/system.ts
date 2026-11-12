import { mkdirSync } from "node:fs";
import type { Clock, Folders } from "@scripts/dev/types/dev";

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => Bun.sleep(ms),
};

export const nodeFolders: Folders = {
  ensure: (directories) => {
    for (const directory of directories) mkdirSync(directory, { recursive: true });
  },
};
