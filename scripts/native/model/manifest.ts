import type { LibraryEntry, NativeManifest } from "../types/native-build";
import { SQLITE3MC_ARCHIVE } from "./inputs";

export const LINUX_LIBRARY = "libsqlite3mc.so";

export type ParsedManifest = { manifest: NativeManifest } | { error: string };

/** The manifest for one linux-x64 build of sqlite3mc. */
export function buildManifest(sha256: string): NativeManifest {
  return {
    version: 1,
    libraries: {
      sqlite3mc: {
        "linux-x64": {
          file: LINUX_LIBRARY,
          sha256,
          sqliteVersion: SQLITE3MC_ARCHIVE.sqliteVersion,
        },
      },
    },
  };
}

export function manifestText(manifest: NativeManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The first key that is not allowed, with its path. */
function unexpectedKey(value: Record<string, unknown>, allowed: string[], path: string) {
  const key = Object.keys(value).find((name) => !allowed.includes(name));
  return key === undefined ? undefined : `unexpected key ${path}${key}`;
}

function entryError(entry: Record<string, unknown>, path: string): string | undefined {
  const extra = unexpectedKey(entry, ["file", "sha256", "sqliteVersion"], `${path}.`);
  if (extra !== undefined) return extra;
  const { file, sha256, sqliteVersion } = entry;
  if (typeof file !== "string" || !/^[\w.-]+$/.test(file) || file.startsWith(".")) {
    return `${path}.file must be a plain file name`;
  }
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
    return `${path}.sha256 must be 64 lowercase hex characters`;
  }
  if (typeof sqliteVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(sqliteVersion)) {
    return `${path}.sqliteVersion must be a version like 3.54.0`;
  }
  return undefined;
}

function shapeError(value: unknown): string | undefined {
  if (!isObject(value)) return "the top level must be an object";
  if (value.version !== 1) return "version must be 1";
  const { libraries } = value;
  if (!isObject(libraries)) return "libraries must be an object";
  const extra = unexpectedKey(value, ["version", "libraries"], "");
  if (extra !== undefined) return extra;
  const { sqlite3mc } = libraries;
  if (!isObject(sqlite3mc)) return "libraries.sqlite3mc must be an object";
  const extraLibrary = unexpectedKey(libraries, ["sqlite3mc"], "libraries.");
  if (extraLibrary !== undefined) return extraLibrary;
  const linux = sqlite3mc["linux-x64"];
  if (!isObject(linux)) return "libraries.sqlite3mc.linux-x64 must be an object";
  return (
    unexpectedKey(sqlite3mc, ["linux-x64"], "libraries.sqlite3mc.") ??
    entryError(linux, "libraries.sqlite3mc.linux-x64")
  );
}

/** Reads a manifest with exactly the expected shape; an error names the field, never its value. */
export function parseManifest(text: string): ParsedManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "manifest.json is not valid JSON" };
  }
  const error = shapeError(value);
  if (error !== undefined) return { error: `manifest.json: ${error}` };
  const { sqlite3mc } = (value as NativeManifest).libraries;
  const entry = sqlite3mc["linux-x64"] as LibraryEntry;
  // Rebuilt field by field, so nothing else from the parsed text survives.
  return {
    manifest: {
      version: 1,
      libraries: {
        sqlite3mc: {
          "linux-x64": {
            file: entry.file,
            sha256: entry.sha256,
            sqliteVersion: entry.sqliteVersion,
          },
        },
      },
    },
  };
}
