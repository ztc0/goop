import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import {
  NativeLibraryError,
  NativeManifestError,
  nativeLibraryFolder,
} from "@/shared/vault/native";
import type { NativeFiles, PinnedLibrary } from "@/shared/vault/native/types/native-library";

const LIBRARY = new TextEncoder().encode("a dummy sqlite3mc library");
const TAMPERED = new TextEncoder().encode("a tampered sqlite3mc library");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const short = (bytes: Uint8Array) => sha256(bytes).slice(0, 12);
const PINNED: PinnedLibrary = {
  name: "sqlite3mc",
  file: "libsqlite3mc.so",
  sha256: sha256(LIBRARY),
};
const HOME = "/goop-home";
const FOLDER = join(HOME, "lib", "native", PINNED.sha256);
const TARGET = join(FOLDER, "libsqlite3mc.so");

/**
 * An in-memory file system that records every change. `onRename` lets a test play a same-user
 * process that rewrites the extracted file right after goop installs it.
 */
function fakeFiles(initial: Record<string, Uint8Array> = {}) {
  const files = new Map(Object.entries(initial));
  const modes = new Map<string, number>();
  const ops: string[] = [];
  const reads: string[] = [];
  const fake = {
    files,
    modes,
    ops,
    reads,
    onRename: undefined as ((to: string) => void) | undefined,
    failRename: false,
  };
  const native: NativeFiles = {
    async read(path) {
      reads.push(path);
      const bytes = files.get(path);
      return bytes && new Uint8Array(bytes);
    },
    async makeFolder(path, mode) {
      ops.push(`makeFolder ${path} ${mode.toString(8)}`);
    },
    async write(path, bytes, mode) {
      ops.push(`write ${path} ${mode.toString(8)}`);
      files.set(path, new Uint8Array(bytes));
    },
    async setMode(path, mode) {
      ops.push(`setMode ${path} ${mode.toString(8)}`);
      modes.set(path, mode);
    },
    async rename(from, to) {
      ops.push(`rename ${from} ${to}`);
      if (fake.failRename) throw new Error("rename failed");
      const bytes = files.get(from);
      if (!bytes) throw new Error(`no file ${from}`);
      files.delete(from);
      files.set(to, bytes);
      fake.onRename?.(to);
    },
    async remove(path) {
      ops.push(`remove ${path}`);
      files.delete(path);
    },
  };
  return {
    fake,
    folder: (platform = "linux") =>
      nativeLibraryFolder({ goopHome: HOME, files: native, platform }),
  };
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

describe("native library folder (fake file system)", () => {
  test("a fresh install: 0700 folder, temp file in it, read-only, renamed, then re-verified", async () => {
    const { fake, folder } = fakeFiles();

    const path = await folder().verifiedPath(PINNED, LIBRARY);

    const temp = tempOf(fake.ops);
    expect<string>(path).toBe(TARGET);
    expect(dirname(temp)).toBe(FOLDER);
    expect(temp).not.toBe(TARGET);
    expect(fake.ops).toEqual([
      `makeFolder ${FOLDER} 700`,
      `write ${temp} 600`,
      `setMode ${temp} 500`,
      `rename ${temp} ${TARGET}`,
    ]);
    expect(fake.files.get(TARGET)).toEqual(LIBRARY);
    expect(fake.reads).toEqual([TARGET, TARGET]);
  });

  test("on Windows the extracted file gets the read-only attribute (0400)", async () => {
    const { fake, folder } = fakeFiles();

    await folder("win32").verifiedPath(PINNED, LIBRARY);

    expect(fake.ops[2]).toBe(`setMode ${tempOf(fake.ops)} 400`);
  });

  test("a valid copy is reused and hashed again before every load", async () => {
    const { fake, folder } = fakeFiles({ [TARGET]: LIBRARY });
    const libraries = folder();

    expect<string>(await libraries.verifiedPath(PINNED, LIBRARY)).toBe(TARGET);
    expect<string>(await libraries.verifiedPath(PINNED, LIBRARY)).toBe(TARGET);

    expect(fake.ops).toEqual([]);
    expect(fake.reads).toEqual([TARGET, TARGET]);
  });

  test("the source is read from a path and checked before the folder is touched", async () => {
    const { fake, folder } = fakeFiles({ "/embedded/libsqlite3mc.so": TAMPERED });

    const error = await rejection(folder().verifiedPath(PINNED, "/embedded/libsqlite3mc.so"));

    expect(error).toBeInstanceOf(NativeLibraryError);
    expect(error.message).toBe(
      `The native library sqlite3mc (libsqlite3mc.so) does not match its pinned sha256 in /embedded/libsqlite3mc.so: expected ${short(LIBRARY)}, got ${short(TAMPERED)}. goop did not load it.`,
    );
    expect(fake.reads).toEqual(["/embedded/libsqlite3mc.so"]);
    expect(fake.ops).toEqual([]);
  });

  test("a missing source is refused by path", async () => {
    const { fake, folder } = fakeFiles();

    const error = await rejection(folder().verifiedPath(PINNED, "/embedded/libsqlite3mc.so"));

    expect(error).toBeInstanceOf(NativeLibraryError);
    expect(error.message).toBe(
      "The native library sqlite3mc (libsqlite3mc.so) is missing from /embedded/libsqlite3mc.so. goop did not load it.",
    );
    expect(fake.ops).toEqual([]);
  });

  test("source bytes that do not match the pin are refused without touching the folder", async () => {
    const { fake, folder } = fakeFiles();

    const error = await rejection(folder().verifiedPath(PINNED, TAMPERED));

    expect(error.message).toBe(
      `The native library sqlite3mc (libsqlite3mc.so) does not match its pinned sha256 in the embedded copy: expected ${short(LIBRARY)}, got ${short(TAMPERED)}. goop did not load it.`,
    );
    expect(fake.reads).toEqual([]);
    expect(fake.ops).toEqual([]);
  });

  test("a tampered extracted file is made writable, replaced from the source and re-verified", async () => {
    const { fake, folder } = fakeFiles({ [TARGET]: TAMPERED });

    const path = await folder().verifiedPath(PINNED, LIBRARY);

    const temp = tempOf(fake.ops);
    expect<string>(path).toBe(TARGET);
    expect(fake.ops).toEqual([
      `makeFolder ${FOLDER} 700`,
      `write ${temp} 600`,
      `setMode ${temp} 500`,
      `setMode ${TARGET} 600`,
      `rename ${temp} ${TARGET}`,
    ]);
    expect(fake.files.get(TARGET)).toEqual(LIBRARY);
  });

  test("a extracted file still wrong after one replacement is refused, naming both hashes", async () => {
    const { fake, folder } = fakeFiles();
    fake.onRename = (to) => fake.files.set(to, TAMPERED);

    const error = await rejection(folder().verifiedPath(PINNED, LIBRARY));

    expect(error).toBeInstanceOf(NativeLibraryError);
    expect(error.message).toBe(
      `The native library sqlite3mc (libsqlite3mc.so) does not match its pinned sha256 in ${TARGET}: expected ${short(LIBRARY)}, got ${short(TAMPERED)}. goop did not load it.`,
    );
    expect(fake.ops.filter((op) => op.startsWith("rename "))).toHaveLength(1);
  });

  test("a failed install removes its temporary file and keeps the error", async () => {
    const { fake, folder } = fakeFiles();
    fake.failRename = true;

    const error = await rejection(folder().verifiedPath(PINNED, LIBRARY));

    expect(error.message).toBe("rename failed");
    expect(fake.ops.at(-1)).toBe(`remove ${tempOf(fake.ops)}`);
    expect([...fake.files.keys()]).toEqual([]);
  });

  test("a pinned file name with a path is refused before any file is read", async () => {
    const { fake, folder } = fakeFiles();

    const error = await rejection(
      folder().verifiedPath({ ...PINNED, file: "../libsqlite3mc.so" }, LIBRARY),
    );

    expect(error).toBeInstanceOf(NativeManifestError);
    expect(error.message).toBe(
      'The native library manifest is invalid: sqlite3mc: "file" must be a plain file name, got "../libsqlite3mc.so".',
    );
    expect(fake.reads).toEqual([]);
    expect(fake.ops).toEqual([]);
  });
});
