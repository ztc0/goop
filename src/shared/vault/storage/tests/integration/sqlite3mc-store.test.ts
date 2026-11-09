import { describe, expect, test } from "bun:test";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readlinkSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { newDataKey } from "@/shared/vault/keys";
import { builtNativeLibrary, type VerifiedLibraryPath } from "@/shared/vault/native";
import { type EncryptedStore, StoreLibraryError, sqlite3mcEngine } from "@/shared/vault/storage";
import { encryptedStoreContract } from "@/shared/vault/storage/tests/integration/encrypted-store-contract";

const repo = resolve(import.meta.dir, "..", "..", "..", "..", "..", "..");
// Built by `bun run native-libs:build`; CI has no build until native-library T7, so these tests
// skip there. A built library that does not match its manifest fails here instead of skipping.
const folder = join(repo, ".local", "build", "native");
const missing = process.platform !== "linux" || !existsSync(join(folder, "manifest.json"));
const library = missing
  ? ("" as VerifiedLibraryPath)
  : await builtNativeLibrary({ folder, name: "sqlite3mc", platform: "linux-x64" });

/** Runs `work` on a fresh store in its own folder under `.temp/tests/`, removed afterwards. */
function withStore(work: (store: EncryptedStore) => void) {
  const folder = join(repo, ".temp", "tests", `sqlite3mc-${crypto.randomUUID()}`);
  mkdirSync(folder, { recursive: true });
  const store = sqlite3mcEngine({ library }).open(join(folder, "goop.db"), newDataKey());
  try {
    work(store);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * The deleted files this process holds open. SQLite unlinks a temporary file right after
 * opening it (`unixOpen`), so a folder listing never shows one; `/proc/self/fd` still does.
 */
function openDeletedFiles(): Set<string> {
  const links = readdirSync("/proc/self/fd").map((fd) => {
    try {
      return readlinkSync(`/proc/self/fd/${fd}`);
    } catch {
      return "";
    }
  });
  return new Set(links.filter((link) => link.startsWith("/") && link.endsWith(" (deleted)")));
}

/** Fills a temporary table well past its page cache and sorts it; returns new temp files. */
function tempFilesOf(store: EncryptedStore): string[] {
  const before = openDeletedFiles();
  store.run("PRAGMA temp.cache_size = 10");
  store.run("CREATE TEMP TABLE scratch (body TEXT)");
  store.run(
    "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20000) " +
      "INSERT INTO scratch SELECT 'goop-temp-' || i FROM n",
  );
  store.query("SELECT body FROM scratch ORDER BY body DESC LIMIT 1");
  const opened = [...openDeletedFiles()].filter((link) => !before.has(link));
  store.run("DROP TABLE scratch");
  return opened;
}

describe.skipIf(missing)(
  "sqlite3mc store (skipped without .local/build/native/manifest.json; bun run native-libs:build)",
  () => {
    encryptedStoreContract(() => sqlite3mcEngine({ library }));

    test("the cipher is ChaCha20-Poly1305", () => {
      withStore((store) => {
        expect(store.query("PRAGMA cipher").map(Object.values)).toEqual([["chacha20"]]);
      });
    });

    test("temporary data is kept in memory", () => {
      withStore((store) => {
        expect(store.query("PRAGMA temp_store")).toEqual([{ temp_store: 2 }]);
      });
    });

    test("a temporary table larger than its cache opens no temporary file", () => {
      withStore((store) => {
        expect(tempFilesOf(store)).toEqual([]);
      });
      // SQLITE_TEMP_STORE=3 keeps temporary data in memory even when a connection asks for files.
      withStore((store) => {
        store.run("PRAGMA temp_store = FILE");
        expect(tempFilesOf(store)).toEqual([]);
      });
    });

    test("the temporary file probe sees a file deleted while still open", () => {
      const folder = join(repo, ".temp", "tests", `probe-${crypto.randomUUID()}`);
      mkdirSync(folder, { recursive: true });
      const path = join(folder, "scratch");
      const fd = openSync(path, "w");
      try {
        unlinkSync(path);
        expect(openDeletedFiles()).toContain(`${path} (deleted)`);
      } finally {
        closeSync(fd);
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
  const library = join(repo, ".temp", "no-such-lib.so") as VerifiedLibraryPath;
  expect(() => sqlite3mcEngine({ library })).toThrow(StoreLibraryError);
});
