import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NativeFiles } from "../types/native-build";

/** The local file system. */
export const nodeNativeFiles: NativeFiles = {
  freshDirectory: (parent, prefix) => {
    mkdirSync(parent, { recursive: true });
    return mkdtempSync(join(parent, prefix));
  },
  makeDirectory: (path) => {
    mkdirSync(path, { recursive: true });
  },
  readBytes: (path) => new Uint8Array(readFileSync(path)),
  readText: (path) => readFileSync(path, "utf8"),
  replaceFile: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    const partial = `${path}.part`;
    writeFileSync(partial, content);
    renameSync(partial, path);
  },
  writeFile: (path, content) => {
    writeFileSync(path, content, { flag: "wx" });
  },
};
