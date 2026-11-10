import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  type EmbeddedFile,
  embeddedNativeLibrary,
  NativeLibraryError,
  NativeManifestError,
  nativeLibrarySource,
} from "@/shared/vault/native";
import type { NativeFiles, NativePlatform } from "@/shared/vault/native/types/native-library";

const LIBRARY = new TextEncoder().encode("a dummy sqlite3mc library");
const DLL = new TextEncoder().encode("a dummy sqlite3mc DLL");
const TAMPERED = new TextEncoder().encode("a tampered sqlite3mc library");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const short = (bytes: Uint8Array) => sha256(bytes).slice(0, 12);
const HOME = "/goop-home";
const SO_FOLDER = join(HOME, "lib", "native", sha256(LIBRARY));
const SO = join(SO_FOLDER, "libsqlite3mc.so");
const NO_EMBEDDED =
  "This goop executable has no embedded native library manifest. Build goop with: bun run build";

const manifest = (
  libraries: unknown = {
    sqlite3mc: {
      "linux-x64": { file: "libsqlite3mc.so", sha256: sha256(LIBRARY), sqliteVersion: "3.54.0" },
      "win32-x64": { file: "sqlite3mc.dll", sha256: sha256(DLL), sqliteVersion: "3.54.0" },
    },
  },
) => new TextEncoder().encode(JSON.stringify({ version: 1, libraries }));

/** Embedded files that record which ones were read. */
function embeddedFiles(entries: Record<string, Uint8Array>) {
  const reads: string[] = [];
  const files: EmbeddedFile[] = Object.entries(entries).map(([name, bytes]) => ({
    name,
    bytes: async () => {
      reads.push(name);
      return new Uint8Array(bytes);
    },
  }));
  return { files, reads };
}

/** An in-memory file system that records every change goop makes under GOOP_HOME. */
function fakeFiles() {
  const stored = new Map<string, Uint8Array>();
  const ops: string[] = [];
  const reads: string[] = [];
  const files: NativeFiles = {
    async read(path) {
      reads.push(path);
      return stored.get(path);
    },
    async makeFolder(path, mode) {
      ops.push(`makeFolder ${path} ${mode.toString(8)}`);
    },
    async write(path, bytes, mode) {
      ops.push(`write ${path} ${mode.toString(8)}`);
      stored.set(path, new Uint8Array(bytes));
    },
    async setMode(path, mode) {
      ops.push(`setMode ${path} ${mode.toString(8)}`);
    },
    async rename(from, to) {
      ops.push(`rename ${from} ${to}`);
      const bytes = stored.get(from);
      if (!bytes) throw new Error(`no file ${from}`);
      stored.delete(from);
      stored.set(to, bytes);
    },
    async remove(path) {
      ops.push(`remove ${path}`);
      stored.delete(path);
    },
  };
  return { files, stored, ops, reads };
}

function extract(
  entries: Record<string, Uint8Array>,
  platform: NativePlatform = "linux-x64",
  disk = fakeFiles(),
) {
  const embedded = embeddedFiles(entries);
  const result = embeddedNativeLibrary({
    goopHome: HOME,
    name: "sqlite3mc",
    platform,
    embedded: embedded.files,
    files: disk.files,
  });
  return { result, embedded, disk };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

/** The temporary file goop wrote, taken from the recorded `write`. */
const tempOf = (ops: string[]) => ops.find((op) => op.startsWith("write "))?.split(" ")[1] ?? "";

describe("nativeLibrarySource (S5, S6)", () => {
  test("from source (bun run dev, bun run test) goop loads the built libraries", () => {
    expect(nativeLibrarySource(false, [])).toBe("built");
    expect(nativeLibrarySource(false, ["manifest.json"])).toBe("built");
  });

  test("the compiled executable loads the libraries embedded in it", () => {
    expect(nativeLibrarySource(true, ["libsqlite3mc.so", "manifest.json"])).toBe("embedded");
  });

  test("a compiled executable without the embedded manifest is refused, never sent to .local", () => {
    expect(() => nativeLibrarySource(true, [])).toThrow(new NativeLibraryError(NO_EMBEDDED));
    expect(() => nativeLibrarySource(true, ["libsqlite3mc.so"])).toThrow(
      new NativeLibraryError(NO_EMBEDDED),
    );
  });
});

describe("embeddedNativeLibrary (S6)", () => {
  test("checks the embedded bytes, then writes them to GOOP_HOME/lib/native/<sha256>/", async () => {
    const { result, embedded, disk } = extract({
      "libsqlite3mc.so": LIBRARY,
      "manifest.json": manifest(),
      "sqlite3mc.dll": DLL,
    });

    expect<string>(await result).toBe(SO);
    const temp = tempOf(disk.ops);
    expect(disk.ops).toEqual([
      `makeFolder ${SO_FOLDER} 700`,
      `write ${temp} 600`,
      `setMode ${temp} 500`,
      `rename ${temp} ${SO}`,
    ]);
    expect(disk.stored.get(SO)).toEqual(LIBRARY);
    expect(embedded.reads).toEqual(["manifest.json", "libsqlite3mc.so"]);
  });

  test("on Windows it extracts the DLL read-only (0400)", async () => {
    const folder = join(HOME, "lib", "native", sha256(DLL));
    const { result, disk } = extract(
      { "manifest.json": manifest(), "sqlite3mc.dll": DLL },
      "win32-x64",
    );

    expect<string>(await result).toBe(join(folder, "sqlite3mc.dll"));
    expect(disk.ops[2]).toBe(`setMode ${tempOf(disk.ops)} 400`);
  });

  test("an extracted copy that still matches is reused after it is hashed, its modes set again", async () => {
    const disk = fakeFiles();
    const entries = { "libsqlite3mc.so": LIBRARY, "manifest.json": manifest() };
    await extract(entries, "linux-x64", disk).result;
    disk.ops.length = 0;
    disk.reads.length = 0;

    expect<string>(await extract(entries, "linux-x64", disk).result).toBe(SO);

    expect(disk.ops).toEqual([`makeFolder ${SO_FOLDER} 700`, `setMode ${SO} 500`]);
    expect(disk.reads).toEqual([SO]);
  });

  test("an executable without the embedded manifest is refused before anything is written", async () => {
    const { result, embedded, disk } = extract({ "libsqlite3mc.so": LIBRARY });

    const error = await rejection(result);

    expect(error).toBeInstanceOf(NativeLibraryError);
    expect(error.message).toBe(NO_EMBEDDED);
    expect(embedded.reads).toEqual([]);
    expect(disk.ops).toEqual([]);
  });

  test("an invalid embedded manifest is refused before the library is read", async () => {
    const { result, embedded, disk } = extract({
      "libsqlite3mc.so": LIBRARY,
      "manifest.json": manifest({
        sqlite3mc: { "linux-x64": { file: "../libsqlite3mc.so", sha256: sha256(LIBRARY) } },
      }),
    });

    const error = await rejection(result);

    expect(error).toBeInstanceOf(NativeManifestError);
    expect(error.message).toBe(
      'The native library manifest is invalid: sqlite3mc linux-x64: "file" must be a plain file name, got "../libsqlite3mc.so".',
    );
    expect(embedded.reads).toEqual(["manifest.json"]);
    expect(disk.ops).toEqual([]);
  });

  test("a manifest without this platform's library is refused", async () => {
    const { result, disk } = extract(
      { "libsqlite3mc.so": LIBRARY, "manifest.json": manifest() },
      "win32-x64",
    );

    const error = await rejection(result);

    expect(error).toBeInstanceOf(NativeLibraryError);
    expect(error.message).toBe(
      "The native library sqlite3mc (sqlite3mc.dll) is missing from this goop executable. goop did not load it.",
    );
    expect(disk.ops).toEqual([]);
  });

  test("a library the manifest does not pin for this platform is refused by name", async () => {
    const only = manifest({
      sqlite3mc: { "win32-x64": { file: "sqlite3mc.dll", sha256: sha256(DLL) } },
    });
    const { result, disk } = extract({ "libsqlite3mc.so": LIBRARY, "manifest.json": only });

    const error = await rejection(result);

    expect(error).toBeInstanceOf(NativeManifestError);
    expect(error.message).toBe("This build of goop has no pinned sqlite3mc for linux-x64.");
    expect(disk.ops).toEqual([]);
  });

  test("embedded bytes that do not match the pin are refused and nothing is written", async () => {
    const { result, disk } = extract({ "libsqlite3mc.so": TAMPERED, "manifest.json": manifest() });

    const error = await rejection(result);

    expect(error).toBeInstanceOf(NativeLibraryError);
    expect(error.message).toBe(
      `The native library sqlite3mc (libsqlite3mc.so) does not match its pinned sha256 in the embedded copy: expected ${short(LIBRARY)}, got ${short(TAMPERED)}. goop did not load it.`,
    );
    expect(disk.reads).toEqual([]);
    expect(disk.ops).toEqual([]);
  });
});
