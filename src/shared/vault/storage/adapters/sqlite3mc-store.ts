// The encrypted store on sqlite3mc through `bun:ffi` (S7, ADR 0001). The data key goes to
// `sqlite3_key` as bytes, never as SQL text; values reach SQLite only as bound parameters; every
// statement is finalized and every failed open closes its handle, on every path.
import { type Pointer, ptr, toArrayBuffer } from "bun:ffi";
import type { DataKey } from "@/shared/vault/keys";
import { loadSqlite3mc, type Sqlite3mcNative } from "@/shared/vault/storage/adapters/sqlite3mc-ffi";
import {
  bindingOf,
  checkCipher,
  checkParameterCount,
  checkStoreKey,
  integerValue,
  openFailure,
  resultCodeName,
  SQLITE_DONE,
  SQLITE_OK,
  SQLITE_ROW,
  SQLITE3MC_SQLITE_VERSION,
  StoreError,
  StoreLibraryError,
  StoreOpenError,
} from "@/shared/vault/storage/model/encrypted-store";
import type {
  EncryptedStore,
  EncryptedStoreEngine,
  StoreRow,
  StoreValue,
} from "@/shared/vault/storage/types/encrypted-store";

// READWRITE | CREATE | FULLMUTEX | NOFOLLOW (a symlink is refused).
const OPEN_FLAGS = 0x2 | 0x4 | 0x10000 | 0x01000000;
// SQLITE_TRANSIENT: SQLite copies a bound value before the bind call returns.
const SQLITE_TRANSIENT = -1;
const COLUMN = { integer: 1, float: 2, text: 3, blob: 4 } as const;
const CIPHER = "chacha20";

export interface Sqlite3mcOptions {
  /** The library file; T5 verifies its sha256 before giving the path here. */
  library: string;
  /** The SQLite version the library must report. Tests change it to see the refusal. */
  expectedVersion?: string;
}

const cstr = (text: string) => Buffer.from(`${text}\0`, "utf8");

/** A thenable result: its later work would run after the transaction ended. */
const isThenable = (value: unknown) =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  typeof (value as { then?: unknown }).then === "function";

function readRow(native: Sqlite3mcNative, stmt: Pointer): StoreRow {
  const row: StoreRow = {};
  const count: number = native.column_count(stmt);
  for (let column = 0; column < count; column++) {
    const name = String(native.column_name(stmt, column));
    const type: number = native.column_type(stmt, column);
    let value: StoreValue = null;
    if (type === COLUMN.integer) value = integerValue(native.column_int64(stmt, column));
    else if (type === COLUMN.float) value = native.column_double(stmt, column);
    else if (type === COLUMN.text || type === COLUMN.blob) {
      const data = type === COLUMN.text ? native.column_text : native.column_blob;
      const pointer = data(stmt, column) as Pointer | null;
      const length: number = native.column_bytes(stmt, column);
      // A copy: SQLite reuses its buffer on the next step.
      const bytes =
        pointer && length > 0 ? new Uint8Array(toArrayBuffer(pointer, 0, length).slice(0)) : null;
      if (type === COLUMN.blob) value = bytes ?? new Uint8Array(0);
      else value = bytes ? new TextDecoder().decode(bytes) : "";
    }
    // Defined, not assigned: `row["__proto__"] = 1` would hit the prototype setter instead.
    Object.defineProperty(row, name, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return row;
}

function bindAll(native: Sqlite3mcNative, stmt: Pointer, params: readonly StoreValue[]) {
  checkParameterCount(native.bind_parameter_count(stmt), params.length);
  params.forEach((param, index) => {
    const position = index + 1;
    const binding = bindingOf(param, position);
    let rc: number;
    if (binding.kind === "null") rc = native.bind_null(stmt, position);
    else if (binding.kind === "int64") rc = native.bind_int64(stmt, position, binding.value);
    else if (binding.kind === "double") rc = native.bind_double(stmt, position, binding.value);
    else {
      // A trailing byte keeps the pointer valid for an empty value, which would bind NULL.
      const bytes =
        binding.kind === "text" ? Buffer.from(binding.value, "utf8") : Buffer.from(binding.value);
      const buffer = Buffer.concat([bytes, Buffer.alloc(1)]);
      const bindData = binding.kind === "text" ? native.bind_text : native.bind_blob;
      rc = bindData(stmt, position, buffer, bytes.length, SQLITE_TRANSIENT);
    }
    if (rc !== SQLITE_OK) throw new StoreError("bind a parameter", resultCodeName(rc));
  });
}

/** Prepares, binds, steps and always finalizes one statement. */
function execute(
  native: Sqlite3mcNative,
  db: Pointer,
  sql: string,
  params: readonly StoreValue[],
): StoreRow[] {
  const text = cstr(sql);
  const out = new BigUint64Array(1);
  const tail = new BigUint64Array(1);
  const prepared: number = native.prepare_v2(db, text, text.length, out, tail);
  if (prepared !== SQLITE_OK) throw new StoreError("prepare a statement", resultCodeName(prepared));
  const stmt = Number(out[0]) as Pointer;
  try {
    const rest = text.subarray(Number(tail[0]) - ptr(text), -1).toString("utf8");
    if (!stmt || rest.trim() !== "") {
      throw new StoreError("prepare a statement", "misuse", "it must hold exactly one statement");
    }
    bindAll(native, stmt, params);
    const rows: StoreRow[] = [];
    for (;;) {
      const rc: number = native.step(stmt);
      if (rc === SQLITE_DONE) return rows;
      if (rc !== SQLITE_ROW) throw new StoreError("run a statement", resultCodeName(rc));
      rows.push(readRow(native, stmt));
    }
  } finally {
    if (stmt) native.finalize(stmt);
  }
}

function openStore(native: Sqlite3mcNative, path: string, key: DataKey): EncryptedStore {
  checkStoreKey(key);
  const out = new BigUint64Array(1);
  const opened: number = native.open_v2(cstr(path), out, OPEN_FLAGS, null);
  const db = Number(out[0]) as Pointer;
  let ready = false;
  try {
    if (opened !== SQLITE_OK) throw new StoreError("open", resultCodeName(opened));
    const cipher: number = native.mc_cipher_index(cstr(CIPHER));
    checkCipher(CIPHER, cipher, native.mc_config(db, cstr("cipher"), cipher));
    const keyed: number = native.key(db, key, key.length);
    if (keyed !== SQLITE_OK) throw new StoreError("set the key", resultCodeName(keyed));
    // A wrong key is only noticed on the first read (T10 finding 6): prove it now.
    try {
      execute(native, db, "SELECT count(*) FROM sqlite_master", []);
    } catch (error) {
      if (error instanceof StoreError && openFailure(error.code) === "wrong-key") {
        throw new StoreOpenError();
      }
      throw error;
    }
    // sqlite3mc does not encrypt temporary files: temporary tables, sort data and transient
    // databases (header comment of sqlite3mc_amalgamation.c 2.6.1), and its `encrypt_temp_db`
    // covers only the temporary database. So they stay in memory, set once the key is proven and
    // before any caller's statement.
    execute(native, db, "PRAGMA temp_store = MEMORY", []);
    ready = true;
  } finally {
    // open_v2 gives a handle even when it fails; it is closed on every failed path.
    if (!ready && db) native.close_v2(db);
  }

  let closed = false;
  let inTransaction = false;
  const usable = () => {
    if (closed) throw new StoreError("run a statement", "closed", "the store is closed");
  };
  const run = (sql: string, params: readonly StoreValue[] = []) => {
    usable();
    return execute(native, db, sql, params);
  };

  return {
    run(sql, params) {
      run(sql, params);
    },
    query: run,
    transaction(work) {
      usable();
      if (inTransaction) {
        throw new StoreError("start a transaction", "nested", "transactions do not nest");
      }
      run("BEGIN IMMEDIATE");
      inTransaction = true;
      try {
        const result = work();
        if (isThenable(result)) {
          // A rejected promise would be unhandled; any other thenable is never called.
          if (result instanceof Promise) result.catch(() => {});
          throw new StoreError("commit", "async", "the transaction work must be synchronous");
        }
        run("COMMIT");
        return result;
      } catch (error) {
        // A failed COMMIT can leave the transaction open too; ROLLBACK ends it either way. The
        // first error is the one reported.
        try {
          if (native.get_autocommit(db) === 0) run("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      native.close_v2(db);
    },
  };
}

/** Loads sqlite3mc from `library` and checks its version before any database is opened. */
export function sqlite3mcEngine(options: Sqlite3mcOptions): EncryptedStoreEngine {
  const expected = options.expectedVersion ?? SQLITE3MC_SQLITE_VERSION;
  let native: Sqlite3mcNative;
  try {
    native = loadSqlite3mc(options.library);
  } catch {
    throw new StoreLibraryError(`${options.library} could not be opened`);
  }
  const version = String(native.libversion());
  if (version !== expected) {
    throw new StoreLibraryError(`it reports SQLite ${version}, expected ${expected}`);
  }
  return { open: (path, key) => openStore(native, path, key) };
}
