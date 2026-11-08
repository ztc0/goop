import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
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
  readBytes: (path) => new Uint8Array(readFileSync(path)),
  writeBytes: (path, content, mode) => {
    // One temporary file per write: two writers of the same target never share one.
    const partial = `${path}.${crypto.randomUUID()}.part`;
    try {
      writeFileSync(partial, content, mode === undefined ? { flag: "wx" } : { mode, flag: "wx" });
      renameSync(partial, path);
    } catch (error) {
      rmSync(partial, { force: true });
      throw error;
    }
  },
  freshDirectory: (parent, prefix) => {
    mkdirSync(parent, { recursive: true });
    return mkdtempSync(join(parent, prefix));
  },
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
