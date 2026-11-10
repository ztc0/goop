import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { builtNativeLibrary, NativeLibraryError, NativeManifestError } from "@/shared/vault/native";
import type { NativeFiles } from "@/shared/vault/native/types/native-library";

const LIBRARY = new TextEncoder().encode("a dummy sqlite3mc library");
const TAMPERED = new TextEncoder().encode("a tampered sqlite3mc library");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const FOLDER = "/repo/.local/build/native";
const MANIFEST = join(FOLDER, "manifest.json");
const SO = join(FOLDER, "linux-x64", "libsqlite3mc.so");
const DLL = join(FOLDER, "win32-x64", "sqlite3mc.dll");

const manifest = (
  libraries: unknown = {
    sqlite3mc: {
      "linux-x64": { file: "libsqlite3mc.so", sha256: sha256(LIBRARY), sqliteVersion: "3.54.0" },
      "win32-x64": { file: "sqlite3mc.dll", sha256: sha256(LIBRARY), sqliteVersion: "3.54.0" },
    },
  },
) => new TextEncoder().encode(JSON.stringify({ version: 1, libraries }));

/** Only reads: the built folder belongs to the build script, goop never writes there. */
function fakeFiles(initial: Record<string, Uint8Array>) {
  const reads: string[] = [];
  const files: NativeFiles = {
    async read(path) {
      reads.push(path);
      return initial[path];
    },
    makeFolder: () => Promise.reject(new Error("no folder may be created")),
    write: () => Promise.reject(new Error("no file may be written")),
    setMode: () => Promise.reject(new Error("no mode may change")),
    rename: () => Promise.reject(new Error("no file may be renamed")),
    remove: () => Promise.reject(new Error("no file may be removed")),
  };
  return { files, reads };
}

const load = (
  initial: Record<string, Uint8Array>,
  platform: "linux-x64" | "win32-x64" = "linux-x64",
) =>
  builtNativeLibrary({
    folder: FOLDER,
    name: "sqlite3mc",
    platform,
    files: fakeFiles(initial).files,
  });

describe("builtNativeLibrary (S4, S5)", () => {
  test("returns the platform's library path when its sha256 matches the manifest", async () => {
    expect<string>(await load({ [MANIFEST]: manifest(), [SO]: LIBRARY })).toBe(SO);
    expect<string>(await load({ [MANIFEST]: manifest(), [DLL]: LIBRARY }, "win32-x64")).toBe(DLL);
  });

  test("hashes the library on every call, so a file changed after the first load is refused", async () => {
    const initial = { [MANIFEST]: manifest(), [SO]: LIBRARY };
    const { files, reads } = fakeFiles(initial);
    const options = { folder: FOLDER, name: "sqlite3mc", platform: "linux-x64" as const, files };
    await builtNativeLibrary(options);
    initial[SO] = TAMPERED;
    await expect(builtNativeLibrary(options)).rejects.toThrow(
      new NativeLibraryError(
        `The native library sqlite3mc (libsqlite3mc.so) does not match its pinned sha256 in ${SO}: expected ${sha256(LIBRARY).slice(0, 12)}, got ${sha256(TAMPERED).slice(0, 12)}. goop did not load it.`,
      ),
    );
    expect(reads).toEqual([MANIFEST, SO, MANIFEST, SO]);
  });

  test("a missing manifest names the command that builds it", async () => {
    await expect(load({ [SO]: LIBRARY })).rejects.toThrow(
      new NativeLibraryError(
        `The native library manifest is missing from ${MANIFEST}. Build the libraries with: bun run native-libs:build`,
      ),
    );
  });

  test("a missing library names the command that builds it", async () => {
    await expect(load({ [MANIFEST]: manifest() })).rejects.toThrow(
      new NativeLibraryError(
        `The native library sqlite3mc (libsqlite3mc.so) is missing from ${SO}. Build the libraries with: bun run native-libs:build`,
      ),
    );
  });

  test("an invalid manifest is refused before any library is read", async () => {
    const { files, reads } = fakeFiles({
      [MANIFEST]: manifest({
        sqlite3mc: { "linux-x64": { file: "../evil.so", sha256: sha256(LIBRARY) } },
      }),
      [SO]: LIBRARY,
    });
    await expect(
      builtNativeLibrary({ folder: FOLDER, name: "sqlite3mc", platform: "linux-x64", files }),
    ).rejects.toThrow(NativeManifestError);
    expect(reads).toEqual([MANIFEST]);
  });

  test("a manifest without the library for this platform is refused", async () => {
    const only = manifest({
      sqlite3mc: { "win32-x64": { file: "sqlite3mc.dll", sha256: sha256(LIBRARY) } },
    });
    await expect(load({ [MANIFEST]: only, [SO]: LIBRARY })).rejects.toThrow(
      new NativeManifestError("This build of goop has no pinned sqlite3mc for linux-x64."),
    );
  });
});
