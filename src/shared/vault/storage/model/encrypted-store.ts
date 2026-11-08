// The pure side of the encrypted store (S7): what SQLite's result codes mean to goop, how values
// are bound and read, and the store's errors. No error ever carries the key, the SQL parameters
// or row data, and none quotes SQLite's own message, which can echo them.
import type { StoreValue } from "@/shared/vault/storage/types/encrypted-store";

/** The SQLite version inside sqlite3mc 2.6.1. A mismatch means the wrong library or slots. */
export const SQLITE3MC_SQLITE_VERSION = "3.54.0";
export const STORE_KEY_BYTES = 32;

export const SQLITE_OK = 0;
export const SQLITE_ROW = 100;
export const SQLITE_DONE = 101;

/** sqlite3.h primary result codes; an extended code keeps its primary code in the low byte. */
const CODE_NAMES: Readonly<Record<number, string>> = {
  1: "error",
  2: "internal",
  3: "permission",
  4: "abort",
  5: "busy",
  6: "locked",
  7: "no-memory",
  8: "read-only",
  9: "interrupt",
  10: "io-error",
  11: "corrupt",
  13: "full",
  14: "cannot-open",
  18: "too-big",
  19: "constraint",
  20: "mismatch",
  21: "misuse",
  25: "range",
  26: "not-a-database",
};

export function resultCodeName(code: number): string {
  return CODE_NAMES[code & 0xff] ?? `error-${code}`;
}

/**
 * How a failed first read after setting the key is reported. With an authenticated cipher a
 * wrong key and a changed page look the same, so both are the one open error; anything else
 * (a busy or unreadable file) keeps its code.
 */
export function openFailure(code: string): "wrong-key" | "error" {
  return code === "not-a-database" || code === "corrupt" ? "wrong-key" : "error";
}

/** The key is wrong, or the file was changed. It never says which. */
export class StoreOpenError extends Error {
  override name = "StoreOpenError";
  constructor() {
    super("The encrypted store could not be opened: the key is wrong or the file was changed.");
  }
}

/** A failed store operation. `code` is a result-code name, or `closed`, `nested`, `async`. */
export class StoreError extends Error {
  override name = "StoreError";
  readonly code: string;
  constructor(operation: string, code: string, detail = code) {
    super(`The encrypted store could not ${operation}: ${detail}.`);
    this.code = code;
  }
}

/** The native library is missing, or is not the one goop was built against. */
export class StoreLibraryError extends Error {
  override name = "StoreLibraryError";
  constructor(detail: string) {
    super(`The encrypted store library could not be loaded: ${detail}.`);
  }
}

export function checkStoreKey(key: Uint8Array): void {
  if (key.length !== STORE_KEY_BYTES) {
    throw new StoreError("open", "misuse", `the key is not ${STORE_KEY_BYTES} bytes`);
  }
}

/**
 * Whether sqlite3mc took the cipher. `sqlite3mc_cipher_index` gives -1 for an unknown name, and
 * `sqlite3mc_config` then only reads the current cipher instead of failing, so the index and the
 * value it reports are both checked (`sqlite3mc_config` in sqlite3mc 2.6.1).
 */
export function checkCipher(name: string, index: number, configured: number): void {
  if (index < 1 || configured !== index) {
    throw new StoreError("open", "error", `the ${name} cipher is not available`);
  }
}

export function checkParameterCount(expected: number, given: number): void {
  if (expected !== given) {
    throw new StoreError(
      "bind a parameter",
      "range",
      `the statement takes ${expected} and got ${given}`,
    );
  }
}

export type Binding =
  | { kind: "null" }
  | { kind: "int64"; value: bigint }
  | { kind: "double"; value: number }
  | { kind: "text"; value: string }
  | { kind: "blob"; value: Uint8Array };

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/**
 * The SQLite type a value is bound as. A safe integer is an INTEGER; any other finite number a
 * REAL, so 2^60 as a number keeps its rounding. A refusal names the position, never the value.
 */
export function bindingOf(value: StoreValue, position = 1): Binding {
  const refuse = (reason: string) =>
    new StoreError("bind a parameter", "mismatch", `parameter ${position} ${reason}`);
  if (value === null) return { kind: "null" };
  if (typeof value === "string") return { kind: "text", value };
  if (value instanceof Uint8Array) return { kind: "blob", value };
  if (typeof value === "bigint") {
    if (value < INT64_MIN || value > INT64_MAX) throw refuse("does not fit in 64 bits");
    return { kind: "int64", value };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw refuse("is not a finite number");
    return Number.isSafeInteger(value)
      ? { kind: "int64", value: BigInt(value) }
      : { kind: "double", value };
  }
  throw refuse(`has the unsupported type ${typeof value}`);
}

/** An INTEGER column: a number while it is exact, a bigint past 2^53. */
export function integerValue(raw: number | bigint): number | bigint {
  if (typeof raw === "number") return raw;
  return raw >= BigInt(Number.MIN_SAFE_INTEGER) && raw <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(raw)
    : raw;
}
