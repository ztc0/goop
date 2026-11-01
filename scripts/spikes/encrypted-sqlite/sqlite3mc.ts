// Minimal bun:ffi wrapper over SQLite3MultipleCiphers (T10 spike, not production code).
//
// libsqlite3mc.so is built with SQLITE3MC_USE_DISPATCH_TABLE: every sqlite3_* symbol is static
// and the library exports only pointers to three tables of function pointers. The wrapper reads
// the functions out of those tables. A library with plain sqlite3_* exports (for example the
// official Windows DLL) is loaded by symbol name instead.
import {
  CFunction,
  CString,
  dlopen,
  type FFIFunction,
  type Pointer,
  read,
  toArrayBuffer,
} from "bun:ffi";

const SQLITE_OK = 0;
const SQLITE_ROW = 100;
const SQLITE_DONE = 101;
const SQLITE_INTEGER = 1;
const SQLITE_FLOAT = 2;
const SQLITE_TEXT = 3;
const SQLITE_BLOB = 4;
// SQLITE_TRANSIENT: SQLite copies bound values before the call returns.
const SQLITE_TRANSIENT = -1;

export const OPEN_READWRITE = 0x2;
export const OPEN_CREATE = 0x4;

type Spec = FFIFunction & { slot: number };

// Slots are offsetof(sqlite3_api_routines, field) / sizeof(void*) from sqlite3ext.h of
// SQLite 3.54.0, computed with the C compiler; libversion() is checked at load time.
const EXT = {
  bind_blob: { slot: 2, args: ["ptr", "i32", "ptr", "i32", "i64"], returns: "i32" },
  bind_double: { slot: 3, args: ["ptr", "i32", "f64"], returns: "i32" },
  bind_int: { slot: 4, args: ["ptr", "i32", "i32"], returns: "i32" },
  bind_int64: { slot: 5, args: ["ptr", "i32", "i64"], returns: "i32" },
  bind_text: { slot: 10, args: ["ptr", "i32", "ptr", "i32", "i64"], returns: "i32" },
  column_blob: { slot: 19, args: ["ptr", "i32"], returns: "ptr" },
  column_bytes: { slot: 20, args: ["ptr", "i32"], returns: "i32" },
  column_count: { slot: 22, args: ["ptr"], returns: "i32" },
  column_double: { slot: 27, args: ["ptr", "i32"], returns: "f64" },
  column_int: { slot: 28, args: ["ptr", "i32"], returns: "i32" },
  column_int64: { slot: 29, args: ["ptr", "i32"], returns: "i64" },
  column_text: { slot: 36, args: ["ptr", "i32"], returns: "ptr" },
  column_type: { slot: 38, args: ["ptr", "i32"], returns: "i32" },
  errmsg: { slot: 53, args: ["ptr"], returns: "cstring" },
  exec: { slot: 55, args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
  finalize: { slot: 57, args: ["ptr"], returns: "i32" },
  free: { slot: 58, args: ["ptr"], returns: "void" },
  libversion: { slot: 66, args: [], returns: "cstring" },
  step: { slot: 94, args: ["ptr"], returns: "i32" },
  prepare_v2: { slot: 116, args: ["ptr", "ptr", "i32", "ptr", "ptr"], returns: "i32" },
  open_v2: { slot: 135, args: ["ptr", "ptr", "i32", "ptr"], returns: "i32" },
  close_v2: { slot: 179, args: ["ptr"], returns: "i32" },
  load_extension: { slot: 196, args: ["ptr", "ptr", "ptr", "ptr"], returns: "i32" },
} satisfies Record<string, Spec>;

// sqlite3mc_core_routines: enable_load_extension is not part of sqlite3_api_routines.
const CORE = {
  enable_load_extension: { slot: 3, args: ["ptr", "i32"], returns: "i32" },
} satisfies Record<string, Spec>;

type Name = keyof typeof EXT | keyof typeof CORE;
// biome-ignore lint/suspicious/noExplicitAny: FFI calls are typed by the wrappers below.
type Native = Record<Name, (...args: any[]) => any>;

export type Value = number | string | Uint8Array | Float32Array;
export type Row = (number | string | Uint8Array | null)[];

function cstr(text: string): Buffer {
  return Buffer.from(`${text}\0`, "utf8");
}

function withoutSlot({ slot: _slot, ...spec }: Spec): FFIFunction {
  return spec;
}

function fromTables(path: string): { native: Native; mode: "dispatch-table" } {
  const lib = dlopen(path, {
    sqlite3mc_api_ext: { args: [], returns: "void" },
    sqlite3mc_api_core: { args: [], returns: "void" },
  });
  // The symbols are data (table pointers): only their addresses are used, never called.
  const tableOf = (symbol: unknown): Pointer =>
    read.ptr((symbol as { ptr: Pointer }).ptr, 0) as Pointer;
  const ext = tableOf(lib.symbols.sqlite3mc_api_ext);
  const core = tableOf(lib.symbols.sqlite3mc_api_core);
  const native = {} as Native;
  const bind = (table: Pointer, specs: Record<string, Spec>) => {
    for (const [name, spec] of Object.entries(specs)) {
      const fn = read.ptr(table, spec.slot * 8) as Pointer;
      native[name as Name] = CFunction({
        ...withoutSlot(spec),
        ptr: fn,
      }) as unknown as Native[Name];
    }
  };
  bind(ext, EXT);
  bind(core, CORE);
  return { native, mode: "dispatch-table" };
}

function fromExports(path: string): { native: Native; mode: "exports" } {
  const specs: Record<string, FFIFunction> = {};
  for (const [name, spec] of Object.entries({ ...EXT, ...CORE })) {
    specs[`sqlite3_${name}`] = withoutSlot(spec);
  }
  const lib = dlopen(path, specs);
  const native = {} as Native;
  for (const name of Object.keys({ ...EXT, ...CORE }) as Name[]) {
    native[name] = lib.symbols[`sqlite3_${name}`] as Native[Name];
  }
  return { native, mode: "exports" };
}

export class Sqlite3mc {
  private constructor(
    private readonly native: Native,
    readonly mode: "dispatch-table" | "exports",
  ) {}

  static load(path: string, expectedVersion: string): Sqlite3mc {
    let loaded: { native: Native; mode: "dispatch-table" | "exports" };
    try {
      loaded = fromTables(path);
    } catch {
      loaded = fromExports(path);
    }
    const lib = new Sqlite3mc(loaded.native, loaded.mode);
    const version = lib.version();
    if (version !== expectedVersion) {
      throw new Error(`sqlite3mc reports SQLite ${version}, expected ${expectedVersion}`);
    }
    return lib;
  }

  version(): string {
    return String(this.native.libversion());
  }

  open(path: string, flags = OPEN_READWRITE | OPEN_CREATE): Connection {
    const out = new BigUint64Array(1);
    const rc = this.native.open_v2(cstr(path), out, flags, null);
    const handle = Number(out[0]) as Pointer;
    if (rc !== SQLITE_OK) {
      const message = handle ? String(this.native.errmsg(handle)) : `rc ${rc}`;
      if (handle) this.native.close_v2(handle);
      throw new Error(`open ${path}: ${message}`);
    }
    return new Connection(this.native, handle);
  }
}

export class Connection {
  private open = true;

  constructor(
    private readonly native: Native,
    private readonly db: Pointer,
  ) {}

  private fail(what: string, rc: number): never {
    throw new Error(`${what}: ${String(this.native.errmsg(this.db))} (rc ${rc})`);
  }

  /** Sets the key. Must be the first statement on the connection. */
  key(passphrase: string): void {
    this.exec(`PRAGMA key = '${passphrase.replaceAll("'", "''")}'`);
  }

  exec(sql: string): void {
    const err = new BigUint64Array(1);
    const rc = this.native.exec(this.db, cstr(sql), null, null, err);
    if (rc !== SQLITE_OK) {
      const pointer = Number(err[0]) as Pointer;
      const message = pointer ? new CString(pointer).toString() : `rc ${rc}`;
      if (pointer) this.native.free(pointer);
      throw new Error(`exec: ${message} (rc ${rc})`);
    }
  }

  query(sql: string, params: Value[] = []): Row[] {
    const out = new BigUint64Array(1);
    const rc = this.native.prepare_v2(this.db, cstr(sql), -1, out, null);
    if (rc !== SQLITE_OK) this.fail("prepare", rc);
    const stmt = Number(out[0]) as Pointer;
    try {
      params.forEach((value, index) => {
        this.bindValue(stmt, index + 1, value);
      });
      const rows: Row[] = [];
      for (;;) {
        const step = this.native.step(stmt);
        if (step === SQLITE_DONE) return rows;
        if (step !== SQLITE_ROW) this.fail("step", step);
        rows.push(this.readRow(stmt));
      }
    } finally {
      this.native.finalize(stmt);
    }
  }

  private bindValue(stmt: Pointer, index: number, value: Value): void {
    let rc: number;
    if (typeof value === "string") {
      const bytes = Buffer.from(value, "utf8");
      rc = this.native.bind_text(stmt, index, bytes, bytes.length, SQLITE_TRANSIENT);
    } else if (typeof value === "number") {
      rc = Number.isInteger(value)
        ? this.native.bind_int64(stmt, index, value)
        : this.native.bind_double(stmt, index, value);
    } else {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      rc = this.native.bind_blob(stmt, index, bytes, bytes.length, SQLITE_TRANSIENT);
    }
    if (rc !== SQLITE_OK) this.fail(`bind ${index}`, rc);
  }

  private readRow(stmt: Pointer): Row {
    const row: Row = [];
    const count = this.native.column_count(stmt);
    for (let column = 0; column < count; column++) {
      const type = this.native.column_type(stmt, column);
      if (type === SQLITE_INTEGER) {
        // "i64" may come back as a bigint; the spike only stores small integers.
        row.push(Number(this.native.column_int64(stmt, column)));
      } else if (type === SQLITE_FLOAT) {
        row.push(this.native.column_double(stmt, column));
      } else if (type === SQLITE_TEXT) {
        const pointer = this.native.column_text(stmt, column) as Pointer;
        const length = this.native.column_bytes(stmt, column);
        row.push(length === 0 ? "" : new CString(pointer, 0, length).toString());
      } else if (type === SQLITE_BLOB) {
        const pointer = this.native.column_blob(stmt, column) as Pointer;
        const length = this.native.column_bytes(stmt, column);
        row.push(
          length === 0
            ? new Uint8Array()
            : new Uint8Array(toArrayBuffer(pointer, 0, length).slice(0)),
        );
      } else {
        row.push(null);
      }
    }
    return row;
  }

  loadExtension(path: string, entryPoint: string): void {
    let rc = this.native.enable_load_extension(this.db, 1);
    if (rc !== SQLITE_OK) this.fail("enable_load_extension", rc);
    const err = new BigUint64Array(1);
    rc = this.native.load_extension(this.db, cstr(path), cstr(entryPoint), err);
    // Turn extension loading off again so SQL cannot call load_extension().
    this.native.enable_load_extension(this.db, 0);
    if (rc !== SQLITE_OK) {
      const pointer = Number(err[0]) as Pointer;
      const message = pointer ? new CString(pointer).toString() : `rc ${rc}`;
      if (pointer) this.native.free(pointer);
      throw new Error(`load_extension ${path}: ${message}`);
    }
  }

  close(): void {
    if (!this.open) return;
    const rc = this.native.close_v2(this.db);
    if (rc !== SQLITE_OK) this.fail("close", rc);
    this.open = false;
  }
}
