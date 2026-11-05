// The native libraries' manifest and cache layout (S8, ADR 0001): the build pins each library's
// sha256, and goop checks a copy against it before every load. Pure: no file is read here.
import { join } from "node:path";
import type {
  NativeManifest,
  NativePlatform,
  PinnedFile,
  PinnedLibrary,
} from "../types/native-library";

const PLATFORMS: readonly NativePlatform[] = ["linux-x64", "win32-x64"];
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

/** The manifest cannot be trusted as written, or lacks the library goop needs. */
export class NativeManifestError extends Error {
  override name = "NativeManifestError";
}

/** A native library cannot be used: missing, or different from the build's pin. */
export class NativeLibraryError extends Error {
  override name = "NativeLibraryError";
}

const invalid = (detail: string) =>
  new NativeManifestError(`The native library manifest is invalid: ${detail}.`);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A plain file name: no folder part in either OS's syntax, and not `.` or `..`. */
const isPlainFileName = (file: string) =>
  file !== "" && file !== "." && file !== ".." && !/[/\\:\0]/.test(file);

/** Refuses a pinned file whose name could leave its cache folder or whose hash is malformed. */
export function checkPinnedFile(value: unknown, label: string): PinnedFile {
  if (!isObject(value)) throw invalid(`${label}: must be an object`);
  const { file, sha256, sqliteVersion } = value;
  if (typeof file !== "string" || !isPlainFileName(file)) {
    throw invalid(`${label}: "file" must be a plain file name, got ${JSON.stringify(file)}`);
  }
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) {
    throw invalid(`${label}: "sha256" must be 64 lowercase hex characters`);
  }
  if (sqliteVersion === undefined) return { file, sha256 };
  if (typeof sqliteVersion !== "string" || !VERSION.test(sqliteVersion)) {
    throw invalid(`${label}: "sqliteVersion" must look like 3.54.0`);
  }
  return { file, sha256, sqliteVersion };
}

/** Reads the build's manifest text; anything but version 1 of the known shape is refused. */
export function parseNativeManifest(text: string): NativeManifest {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw invalid("it is not JSON");
  }
  if (!isObject(data)) throw invalid("it is not an object");
  if (data.version !== 1)
    throw invalid(`unknown version ${JSON.stringify(data.version)} (expected 1)`);
  if (!isObject(data.libraries)) throw invalid('"libraries" must be an object');
  const libraries: NativeManifest["libraries"] = {};
  for (const [name, platforms] of Object.entries(data.libraries)) {
    if (!isObject(platforms)) throw invalid(`${name}: must be an object`);
    const files: Partial<Record<NativePlatform, PinnedFile>> = {};
    for (const [platform, file] of Object.entries(platforms)) {
      if (!PLATFORMS.includes(platform as NativePlatform)) {
        throw invalid(`${name}: unknown platform ${JSON.stringify(platform)}`);
      }
      files[platform as NativePlatform] = checkPinnedFile(file, `${name} ${platform}`);
    }
    libraries[name] = files;
  }
  return { version: 1, libraries };
}

/** The library `name` for `platform`, or a clear refusal when this build has none. */
export function pinnedLibrary(
  manifest: NativeManifest,
  name: string,
  platform: NativePlatform,
): PinnedLibrary {
  const file = Object.hasOwn(manifest.libraries, name)
    ? manifest.libraries[name]?.[platform]
    : undefined;
  if (!file)
    throw new NativeManifestError(`This build of goop has no pinned ${name} for ${platform}.`);
  return { name, ...file };
}

/** The platform key from `process.platform` and `process.arch`. */
export function nativePlatform(platform: string, arch: string): NativePlatform {
  const key = `${platform}-${arch}`;
  if (PLATFORMS.includes(key as NativePlatform)) return key as NativePlatform;
  throw new NativeLibraryError(
    `goop has no native libraries for ${key}; it supports ${PLATFORMS.join(" and ")}.`,
  );
}

/** `<GOOP_HOME>/cache/native/<sha256>/<file>`: one folder per build of a library. */
export function nativeLibraryPath(goopHome: string, pinned: PinnedLibrary) {
  checkPinnedFile(pinned, pinned.name);
  const folder = join(goopHome, "cache", "native", pinned.sha256);
  return { folder, file: join(folder, pinned.file) };
}

/** Read-only: 0500 on Linux (dlopen maps it), 0400 on Windows (only the read-only attribute). */
export const nativeFileMode = (platform: string) => (platform === "win32" ? 0o400 : 0o500);

const short = (sha256: string) => sha256.slice(0, 12);

export function hashMismatch(pinned: PinnedLibrary, where: string, actual: string) {
  return new NativeLibraryError(
    `The native library ${pinned.name} (${pinned.file}) does not match its pinned sha256 in ${where}: expected ${short(pinned.sha256)}, got ${short(actual)}. goop did not load it.`,
  );
}

export function missingLibrary(pinned: PinnedLibrary, path: string) {
  return new NativeLibraryError(
    `The native library ${pinned.name} (${pinned.file}) is missing from ${path}. goop did not load it.`,
  );
}
