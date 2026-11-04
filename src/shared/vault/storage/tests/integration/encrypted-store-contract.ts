// The contract every encrypted-store adapter passes (S7, ADR 0001). It speaks only through the
// `EncryptedStoreEngine` interface, so a future engine runs the same suite unchanged.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type DataKey, newDataKey } from "@/shared/vault/keys";
import {
  type EncryptedStore,
  type EncryptedStoreEngine,
  StoreError,
  StoreOpenError,
} from "@/shared/vault/storage";

const repo = resolve(import.meta.dir, "..", "..", "..", "..", "..", "..");
const MARKER = "goop-plaintext-marker-7f3a";

function thrown(work: () => unknown): Error {
  try {
    work();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a throw");
}

export function encryptedStoreContract(engine: () => EncryptedStoreEngine) {
  let folder: string;
  let file: string;
  const open: EncryptedStore[] = [];

  beforeEach(() => {
    folder = join(repo, ".temp", "tests", `encrypted-store-${crypto.randomUUID()}`);
    mkdirSync(folder, { recursive: true });
    file = join(folder, "goop.db");
  });

  afterEach(() => {
    for (const store of open.splice(0)) store.close();
    rmSync(folder, { recursive: true, force: true });
  });

  const openStore = (key: DataKey) => {
    const store = engine().open(file, key);
    open.push(store);
    return store;
  };

  function seed(key: DataKey) {
    const store = openStore(key);
    store.run("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT, data BLOB)");
    store.run("INSERT INTO notes (body, data) VALUES (?, ?)", [MARKER, new Uint8Array([0, 255])]);
    store.close();
  }

  test("rows written with a key read back after reopening with the same key", () => {
    const key = newDataKey();
    seed(key);

    const rows = openStore(key).query("SELECT id, body, data FROM notes WHERE id = ?", [1]);

    expect(rows).toEqual([{ id: 1, body: MARKER, data: new Uint8Array([0, 255]) }]);
  });

  test("a wrong key is refused at open with the one error, and the file is untouched", () => {
    seed(newDataKey());
    const before = readFileSync(file);

    const error = thrown(() => openStore(newDataKey()));

    expect(error).toBeInstanceOf(StoreOpenError);
    expect(error.message).toBe(
      "The encrypted store could not be opened: the key is wrong or the file was changed.",
    );
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  test("a changed byte in the file is refused", () => {
    const key = newDataKey();
    seed(key);
    const bytes = readFileSync(file);
    bytes[200] = (bytes[200] ?? 0) ^ 0x01;
    writeFileSync(file, bytes);

    expect(thrown(() => openStore(key))).toBeInstanceOf(StoreOpenError);
  });

  test("the file on disk holds no plaintext", () => {
    seed(newDataKey());

    const bytes = readFileSync(file);

    expect(bytes.includes(MARKER)).toBe(false);
    expect(bytes.includes("SQLite format 3")).toBe(false);
  });

  test("a transaction that throws leaves nothing behind", () => {
    const store = openStore(newDataKey());
    store.run("CREATE TABLE notes (body TEXT)");
    const failure = new Error("stop");

    const error = thrown(() =>
      store.transaction(() => {
        store.run("INSERT INTO notes VALUES (?)", ["lost"]);
        throw failure;
      }),
    );

    expect(error).toBe(failure);
    expect(store.query("SELECT count(*) AS n FROM notes")).toEqual([{ n: 0 }]);
    expect(store.transaction(() => store.run("INSERT INTO notes VALUES (?)", ["kept"]))).toBe(
      undefined,
    );
    expect(store.query("SELECT body FROM notes")).toEqual([{ body: "kept" }]);
  });

  test("an async transaction is refused and rolled back", () => {
    const store = openStore(newDataKey());
    store.run("CREATE TABLE notes (body TEXT)");

    const error = thrown(() =>
      // @ts-expect-error the work must be synchronous
      store.transaction(async () => {
        store.run("INSERT INTO notes VALUES (?)", ["lost"]);
      }),
    );

    expect(error).toBeInstanceOf(StoreError);
    expect((error as StoreError).code).toBe("async");
    expect(error.message).toBe(
      "The encrypted store could not commit: the transaction work must be synchronous.",
    );
    expect(store.query("SELECT count(*) AS n FROM notes")).toEqual([{ n: 0 }]);
  });

  test("a transaction whose work returns a thenable is refused and rolled back", () => {
    const store = openStore(newDataKey());
    store.run("CREATE TABLE notes (body TEXT)");
    let thenCalls = 0;

    const error = thrown(() =>
      // @ts-expect-error a thenable is not a synchronous result
      store.transaction(() => {
        store.run("INSERT INTO notes VALUES (?)", ["lost"]);
        return {
          // biome-ignore lint/suspicious/noThenProperty: the thenable is what this test refuses.
          then() {
            thenCalls++;
          },
        };
      }),
    );

    expect(error).toBeInstanceOf(StoreError);
    expect((error as StoreError).code).toBe("async");
    expect(store.query("SELECT count(*) AS n FROM notes")).toEqual([{ n: 0 }]);
    expect(thenCalls).toBe(0);
  });

  test("any column name is an own property of the row, __proto__ and constructor included", () => {
    const store = openStore(newDataKey());

    const [row] = store.query('SELECT 1 AS "__proto__", 2 AS "constructor", 3 AS "id"');

    expect(row).toBeDefined();
    const read = row as Record<string, unknown>;
    expect(Object.entries(read)).toEqual([
      ["__proto__", 1],
      ["constructor", 2],
      ["id", 3],
    ]);
    expect(Object.hasOwn(read, "__proto__")).toBe(true);
    expect(read.__proto__).toBe(1);
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
  });

  test("parameters are stored literally, quotes and SQL included", () => {
    const store = openStore(newDataKey());
    store.run("CREATE TABLE notes (body TEXT)");
    const tricky = "it's'); DROP TABLE notes; --";

    store.run("INSERT INTO notes VALUES (?)", [tricky]);

    expect(store.query("SELECT body FROM notes")).toEqual([{ body: tricky }]);
  });

  test("full-text search with FTS5 MATCH finds the row", () => {
    const store = openStore(newDataKey());
    store.run("CREATE VIRTUAL TABLE offers USING fts5(title)");
    for (const title of ["Senior LangGraph engineer", "Java developer"]) {
      store.run("INSERT INTO offers (title) VALUES (?)", [title]);
    }

    const rows = store.query("SELECT title FROM offers WHERE offers MATCH ?", ['"langgraph"']);

    expect(rows).toEqual([{ title: "Senior LangGraph engineer" }]);
  });

  test("a failing statement is a store error without the row data", () => {
    const store = openStore(newDataKey());
    store.run("CREATE TABLE notes (body TEXT UNIQUE)");
    store.run("INSERT INTO notes VALUES (?)", [MARKER]);

    const error = thrown(() => store.run("INSERT INTO notes VALUES (?)", [MARKER]));

    expect(error).toBeInstanceOf(StoreError);
    expect((error as StoreError).code).toBe("constraint");
    expect(error.message).not.toContain(MARKER);
  });

  test("a closed store refuses further work", () => {
    const store = openStore(newDataKey());
    store.close();
    store.close();

    expect((thrown(() => store.query("SELECT 1")) as StoreError).code).toBe("closed");
  });
}
