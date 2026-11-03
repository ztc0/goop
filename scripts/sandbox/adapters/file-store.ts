import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { FileStore } from "../types/sandbox";

/** The local file system. */
export const nodeFileStore: FileStore = {
  exists: (path) => existsSync(path),
  makeDirectory: (path) => {
    mkdirSync(path, { recursive: true });
  },
  writeFile: (path, content, mode) => {
    writeFileSync(path, content, mode === undefined ? {} : { mode });
  },
  readText: (path) => readFileSync(path, "utf8"),
  listFiles: (directory) =>
    readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({ name: entry.name, size: statSync(join(directory, entry.name)).size })),
  copyFile: (from, to) => {
    copyFileSync(from, to);
  },
  removeDirectory: (path) => {
    rmSync(path, { recursive: true, force: true });
  },
};
