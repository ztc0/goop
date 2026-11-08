import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  NativeLibraryError,
  NativeManifestError,
  nativeFileMode,
  nativeLibraryPath,
  nativePlatform,
  parseNativeManifest,
  pinnedLibrary,
} from "@/shared/vault/native/model/native-library";

const SHA = "0123456789abcdef".repeat(4);
const entry = (fields: Record<string, unknown> = {}) => ({
  file: "libsqlite3mc.so",
  sha256: SHA,
  sqliteVersion: "3.54.0",
  ...fields,
});
const manifest = (linux: unknown = entry(), version: unknown = 1) =>
  JSON.stringify({ version, libraries: { sqlite3mc: { "linux-x64": linux } } });

function thrown(work: () => unknown): Error {
  try {
    work();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a throw");
}

describe("native library manifest", () => {
  test("reads the build's manifest and picks the library for a platform", () => {
    const pinned = pinnedLibrary(parseNativeManifest(manifest()), "sqlite3mc", "linux-x64");

    expect(pinned).toEqual({
      name: "sqlite3mc",
      file: "libsqlite3mc.so",
      sha256: SHA,
      sqliteVersion: "3.54.0",
    });
  });

  test.each([
    ["not JSON", "{", "it is not JSON"],
    ["an unknown version", manifest(entry(), 2), "unknown version 2 (expected 1)"],
    ["no libraries object", '{"version":1,"libraries":[]}', '"libraries" must be an object'],
    [
      "an unknown platform",
      '{"version":1,"libraries":{"sqlite3mc":{"darwin-arm64":{}}}}',
      'sqlite3mc: unknown platform "darwin-arm64"',
    ],
    [
      "an uppercase sha256",
      manifest(entry({ sha256: SHA.toUpperCase() })),
      'sqlite3mc linux-x64: "sha256" must be 64 lowercase hex characters',
    ],
    [
      "a short sha256",
      manifest(entry({ sha256: SHA.slice(1) })),
      'sqlite3mc linux-x64: "sha256" must be 64 lowercase hex characters',
    ],
    [
      "a file with a slash",
      manifest(entry({ file: "lib/libsqlite3mc.so" })),
      'sqlite3mc linux-x64: "file" must be a plain file name, got "lib/libsqlite3mc.so"',
    ],
    [
      "a file with a backslash",
      manifest(entry({ file: "..\\sqlite3mc.dll" })),
      'sqlite3mc linux-x64: "file" must be a plain file name, got "..\\\\sqlite3mc.dll"',
    ],
    [
      "a file named ..",
      manifest(entry({ file: ".." })),
      'sqlite3mc linux-x64: "file" must be a plain file name, got ".."',
    ],
    [
      "a sqliteVersion that is not a version",
      manifest(entry({ sqliteVersion: 3 })),
      'sqlite3mc linux-x64: "sqliteVersion" must look like 3.54.0',
    ],
  ])("refuses %s", (_, text, detail) => {
    const error = thrown(() => parseNativeManifest(text));

    expect(error).toBeInstanceOf(NativeManifestError);
    expect(error.message).toBe(`The native library manifest is invalid: ${detail}.`);
  });

  test("a library missing for this platform is refused by name", () => {
    const error = thrown(() =>
      pinnedLibrary(parseNativeManifest(manifest()), "sqlite3mc", "win32-x64"),
    );

    expect(error).toBeInstanceOf(NativeManifestError);
    expect(error.message).toBe("This build of goop has no pinned sqlite3mc for win32-x64.");
  });
});

describe("native platform", () => {
  test("names the two supported platforms", () => {
    expect(nativePlatform("linux", "x64")).toBe("linux-x64");
    expect(nativePlatform("win32", "x64")).toBe("win32-x64");
  });

  test.each([
    ["darwin", "arm64"],
    ["linux", "arm64"],
  ])("refuses %s-%s", (platform, arch) => {
    const error = thrown(() => nativePlatform(platform, arch));

    expect(error).toBeInstanceOf(NativeLibraryError);
    expect(error.message).toBe(
      `goop has no native libraries for ${platform}-${arch}; it supports linux-x64 and win32-x64.`,
    );
  });
});

describe("native library cache layout", () => {
  test("a library lives in GOOP_HOME/cache/native/<sha256>/<file>", () => {
    const pinned = { name: "sqlite3mc", file: "libsqlite3mc.so", sha256: SHA };

    expect(nativeLibraryPath("/home/u/.goop", pinned)).toEqual({
      folder: join("/home/u/.goop", "cache", "native", SHA),
      file: join("/home/u/.goop", "cache", "native", SHA, "libsqlite3mc.so"),
    });
  });

  test("the cached file is read-only: 0500 on Linux, 0400 (read-only attribute) on Windows", () => {
    expect(nativeFileMode("linux")).toBe(0o500);
    expect(nativeFileMode("win32")).toBe(0o400);
  });
});
