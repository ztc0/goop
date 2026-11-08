// `.local/build/native/manifest.json`, the shape `src/shared/vault/native` reads: version 1,
// then each library's file and sha256 by platform. Pure: no file is read here.
import type { LibraryEntry, NativeManifest, NativePlatform } from "../types/native-libs";

export type ParsedManifest = { manifest: NativeManifest } | { error: string };

const PLATFORMS: readonly string[] = ["linux-x64", "win32-x64"] satisfies NativePlatform[];

/** The manifest with `entry` for `name` on `platform`; every other entry is kept. */
export function withEntry(
  manifest: NativeManifest | undefined,
  name: string,
  platform: NativePlatform,
  entry: LibraryEntry,
): NativeManifest {
  const libraries = manifest?.libraries ?? {};
  return {
    version: 1,
    libraries: { ...libraries, [name]: { ...libraries[name], [platform]: { ...entry } } },
  };
}

export function manifestText(manifest: NativeManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function unexpectedKey(value: Record<string, unknown>, allowed: string[], path: string) {
  const key = Object.keys(value).find((name) => !allowed.includes(name));
  return key === undefined ? undefined : `unexpected key ${path}${key}`;
}

function entryOf(value: unknown, path: string): LibraryEntry | string {
  if (!isObject(value)) return `${path} must be an object`;
  const extra = unexpectedKey(value, ["file", "sha256", "sqliteVersion"], `${path}.`);
  if (extra !== undefined) return extra;
  const { file, sha256, sqliteVersion } = value;
  if (typeof file !== "string" || !/^[\w.+-]+$/.test(file) || file.startsWith(".")) {
    return `${path}.file must be a plain file name`;
  }
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
    return `${path}.sha256 must be 64 lowercase hex characters`;
  }
  if (sqliteVersion === undefined) return { file, sha256 };
  if (typeof sqliteVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(sqliteVersion)) {
    return `${path}.sqliteVersion must be a version like 3.54.0`;
  }
  return { file, sha256, sqliteVersion };
}

function manifestOf(value: unknown): NativeManifest | string {
  if (!isObject(value)) return "the top level must be an object";
  if (value.version !== 1) return "version must be 1";
  if (!isObject(value.libraries)) return "libraries must be an object";
  const extra = unexpectedKey(value, ["version", "libraries"], "");
  if (extra !== undefined) return extra;
  // Rebuilt field by field, so nothing else from the parsed text survives.
  let manifest: NativeManifest = { version: 1, libraries: {} };
  for (const [name, platforms] of Object.entries(value.libraries)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
      return `library name ${JSON.stringify(name)} is invalid`;
    if (!isObject(platforms)) return `libraries.${name} must be an object`;
    for (const [platform, entry] of Object.entries(platforms)) {
      const path = `libraries.${name}.${platform}`;
      if (!PLATFORMS.includes(platform)) return `unknown platform ${path}`;
      const checked = entryOf(entry, path);
      if (typeof checked === "string") return checked;
      manifest = withEntry(manifest, name, platform as NativePlatform, checked);
    }
  }
  return manifest;
}

/** Reads a manifest with exactly the expected shape; an error names the field, never its value. */
export function parseManifest(text: string): ParsedManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "manifest.json is not valid JSON" };
  }
  const manifest = manifestOf(value);
  return typeof manifest === "string" ? { error: `manifest.json ${manifest}` } : { manifest };
}
