import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { newDataKey, StoreLibraryError, sqlite3mcEngine } from "@/shared";
import { encryptedStoreContract } from "./encrypted-store-contract";

const repo = resolve(import.meta.dir, "..", "..", "..", "..");
// Built locally by the T10 spike; CI has no build until T5, so these tests skip there.
const library = join(repo, ".local", "build", "sqlite", "libsqlite3mc.so");
const missing = process.platform !== "linux" || !existsSync(library);

describe.skipIf(missing)(
  "sqlite3mc store (skipped without .local/build/sqlite/libsqlite3mc.so; T5 builds it)",
  () => {
    encryptedStoreContract(() => sqlite3mcEngine({ library }));

    test("the cipher is ChaCha20-Poly1305", () => {
      const folder = join(repo, ".temp", "tests", `sqlite3mc-${crypto.randomUUID()}`);
      mkdirSync(folder, { recursive: true });
      const store = sqlite3mcEngine({ library }).open(join(folder, "goop.db"), newDataKey());
      try {
        expect(store.query("PRAGMA cipher").map(Object.values)).toEqual([["chacha20"]]);
      } finally {
        store.close();
        rmSync(folder, { recursive: true, force: true });
      }
    });

    test("a library that reports another SQLite version is refused before any open", () => {
      expect(() => sqlite3mcEngine({ library, expectedVersion: "3.0.0" })).toThrow(
        new StoreLibraryError("it reports SQLite 3.54.0, expected 3.0.0"),
      );
    });
  },
);

test("a missing library is a library error", () => {
  expect(() => sqlite3mcEngine({ library: join(repo, ".temp", "no-such-lib.so") })).toThrow(
    StoreLibraryError,
  );
});
