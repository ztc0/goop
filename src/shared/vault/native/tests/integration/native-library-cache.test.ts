import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { NativeLibraryError, nativeLibraryCache } from "@/shared/vault/native";
import type { PinnedLibrary } from "@/shared/vault/native/types/native-library";

const repo = resolve(import.meta.dir, "..", "..", "..", "..", "..", "..");
const linux = process.platform === "linux";
const LIBRARY = new TextEncoder().encode("a dummy sqlite3mc library, not a real one");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const PINNED: PinnedLibrary = {
  name: "sqlite3mc",
  file: "libsqlite3mc.so",
  sha256: sha256(LIBRARY),
};

let root = "";
let home = "";
let source = "";
let folder = "";
let target = "";

beforeEach(() => {
  root = join(repo, ".temp", "tests", `native-library-${crypto.randomUUID()}`);
  home = join(root, "home");
  source = join(root, "embedded", PINNED.file);
  folder = join(home, "cache", "native", PINNED.sha256);
  target = join(folder, PINNED.file);
  mkdirSync(join(root, "embedded"), { recursive: true });
  writeFileSync(source, LIBRARY);
});

afterEach(() => {
  if (existsSync(target)) chmodSync(target, 0o600);
  rmSync(root, { recursive: true, force: true });
});

const libraries = () => nativeLibraryCache({ goopHome: home });

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

describe("native library cache (real folder)", () => {
  test("a fresh install copies the library under its sha256 and leaves no temporary file", async () => {
    const path = await libraries().verifiedPath(PINNED, source);

    expect(path).toBe(target);
    expect(new Uint8Array(readFileSync(target))).toEqual(LIBRARY);
    expect(readdirSync(folder)).toEqual([PINNED.file]);
  });

  test.skipIf(!linux)("on Linux the folder is 0700 and the file 0500", async () => {
    await libraries().verifiedPath(PINNED, source);

    expect(statSync(folder).mode & 0o777).toBe(0o700);
    expect(statSync(target).mode & 0o777).toBe(0o500);
  });

  test.skipIf(!linux)("an existing folder with wider modes is tightened to 0700", async () => {
    mkdirSync(folder, { recursive: true, mode: 0o755 });
    chmodSync(folder, 0o755);

    await libraries().verifiedPath(PINNED, LIBRARY);

    expect(statSync(folder).mode & 0o777).toBe(0o700);
  });

  test("a valid cache is reused: the same file, not rewritten", async () => {
    await libraries().verifiedPath(PINNED, source);
    const first = statSync(target);

    const path = await libraries().verifiedPath(PINNED, source);

    expect(path).toBe(target);
    expect(statSync(target).ino).toBe(first.ino);
    expect(statSync(target).mtimeMs).toBe(first.mtimeMs);
  });

  test("a tampered cached file is replaced from the verified source", async () => {
    await libraries().verifiedPath(PINNED, source);
    chmodSync(target, 0o600);
    writeFileSync(target, "tampered");

    const path = await libraries().verifiedPath(PINNED, source);

    expect(path).toBe(target);
    expect(new Uint8Array(readFileSync(target))).toEqual(LIBRARY);
    expect(readdirSync(folder)).toEqual([PINNED.file]);
  });

  test("a tampered source is refused and the cache is never created", async () => {
    writeFileSync(source, "tampered");

    const error = await rejection(libraries().verifiedPath(PINNED, source));

    expect(error).toBeInstanceOf(NativeLibraryError);
    expect(error.message).toBe(
      `The native library sqlite3mc (libsqlite3mc.so) does not match its pinned sha256 in ${source}: expected ${PINNED.sha256.slice(0, 12)}, got ${sha256(new TextEncoder().encode("tampered")).slice(0, 12)}. goop did not load it.`,
    );
    expect(existsSync(join(home, "cache"))).toBe(false);
  });

  test("a wrong pinned hash is refused and nothing is installed", async () => {
    const wrong = { ...PINNED, sha256: sha256(new TextEncoder().encode("another build")) };

    const error = await rejection(libraries().verifiedPath(wrong, source));

    expect(error).toBeInstanceOf(NativeLibraryError);
    expect(error.message).toContain(
      `expected ${wrong.sha256.slice(0, 12)}, got ${PINNED.sha256.slice(0, 12)}`,
    );
    expect(existsSync(join(home, "cache"))).toBe(false);
  });
});
