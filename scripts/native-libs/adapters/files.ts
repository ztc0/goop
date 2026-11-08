import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { NativeLibsFiles } from "../types/native-libs";

/** The local file system. */
export const nodeFiles: NativeLibsFiles = {
  freshDirectory: (parent, prefix) => {
    mkdirSync(parent, { recursive: true });
    return mkdtempSync(join(parent, prefix));
  },
  makeDirectory: (path) => {
    mkdirSync(path, { recursive: true });
  },
  read: (path) => (existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined),
  writeNew: (path, content, mode = 0o644) => {
    writeFileSync(path, content, { flag: "wx", mode });
  },
  replace: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    const partial = `${path}.part`;
    writeFileSync(partial, content);
    renameSync(partial, path);
  },
};
