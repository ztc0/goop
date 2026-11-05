// The sqlite3mc functions goop calls, read through `bun:ffi` from the dispatch-table build
// (ADR 0001): every `sqlite3_*` function there is static, and the library exports only pointers
// to tables of function pointers. A wrong slot or FFI type crashes instead of throwing, so the
// caller checks `libversion` first. Only the adapter `sqlite3mc-store` uses this file.
import { CFunction, dlopen, type FFIFunction, type Pointer, read } from "bun:ffi";

type Spec = FFIFunction & { slot: number };

// offsetof(<table>, field) / sizeof(void*), from the C compiler on the sqlite3ext.h and
// sqlite3mc_amalgamation.c of sqlite3mc 2.6.1 (SQLite 3.54.0). Regenerate on every upgrade.
const EXT = {
  bind_blob: { slot: 2, args: ["ptr", "i32", "ptr", "i32", "i64"], returns: "i32" },
  bind_double: { slot: 3, args: ["ptr", "i32", "f64"], returns: "i32" },
  bind_int64: { slot: 5, args: ["ptr", "i32", "i64"], returns: "i32" },
  bind_null: { slot: 6, args: ["ptr", "i32"], returns: "i32" },
  bind_parameter_count: { slot: 7, args: ["ptr"], returns: "i32" },
  bind_text: { slot: 10, args: ["ptr", "i32", "ptr", "i32", "i64"], returns: "i32" },
  column_blob: { slot: 19, args: ["ptr", "i32"], returns: "ptr" },
  column_bytes: { slot: 20, args: ["ptr", "i32"], returns: "i32" },
  column_count: { slot: 22, args: ["ptr"], returns: "i32" },
  column_double: { slot: 27, args: ["ptr", "i32"], returns: "f64" },
  column_int64: { slot: 29, args: ["ptr", "i32"], returns: "i64" },
  column_name: { slot: 30, args: ["ptr", "i32"], returns: "cstring" },
  column_text: { slot: 36, args: ["ptr", "i32"], returns: "ptr" },
  column_type: { slot: 38, args: ["ptr", "i32"], returns: "i32" },
  finalize: { slot: 57, args: ["ptr"], returns: "i32" },
  get_autocommit: { slot: 60, args: ["ptr"], returns: "i32" },
  libversion: { slot: 66, args: [], returns: "cstring" },
  step: { slot: 94, args: ["ptr"], returns: "i32" },
  prepare_v2: { slot: 116, args: ["ptr", "ptr", "i32", "ptr", "ptr"], returns: "i32" },
  open_v2: { slot: 135, args: ["ptr", "ptr", "i32", "ptr"], returns: "i32" },
  close_v2: { slot: 179, args: ["ptr"], returns: "i32" },
} satisfies Record<string, Spec>;

// sqlite3mc_api_routines: the key and the cipher settings.
const MC = {
  key: { slot: 1, args: ["ptr", "ptr", "i32"], returns: "i32" },
  mc_cipher_index: { slot: 7, args: ["ptr"], returns: "i32" },
  mc_config: { slot: 10, args: ["ptr", "ptr", "i32"], returns: "i32" },
} satisfies Record<string, Spec>;

// biome-ignore lint/suspicious/noExplicitAny: each call site passes the types its spec declares.
type NativeCall = (...args: any[]) => any;
export type Sqlite3mcNative = Record<keyof typeof EXT | keyof typeof MC, NativeCall>;

/** Reads the functions out of the library's tables. Throws when the library cannot be opened. */
export function loadSqlite3mc(path: string): Sqlite3mcNative {
  const library = dlopen(path, {
    sqlite3mc_api_ext: { args: [], returns: "void" },
    sqlite3mc_api_mc: { args: [], returns: "void" },
  });
  // The symbols are data (a pointer to a table): only their address is read, never called.
  const table = (symbol: unknown) => read.ptr((symbol as { ptr: Pointer }).ptr, 0) as Pointer;
  const native = {} as Sqlite3mcNative;
  const bind = (base: Pointer, specs: Record<string, Spec>) => {
    for (const [name, { slot, ...spec }] of Object.entries(specs)) {
      const ptr = read.ptr(base, slot * 8) as Pointer;
      native[name as keyof Sqlite3mcNative] = CFunction({ ...spec, ptr }) as unknown as NativeCall;
    }
  };
  bind(table(library.symbols.sqlite3mc_api_ext), EXT);
  bind(table(library.symbols.sqlite3mc_api_mc), MC);
  return native;
}
