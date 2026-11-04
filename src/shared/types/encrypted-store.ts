import type { DataKey } from "./key-envelope";

/**
 * A value bound to a statement or read from a row. Integers past 2^53 come back as bigints;
 * a blob comes back as a copy that the store no longer references.
 */
export type StoreValue = null | number | bigint | string | Uint8Array;

/** One row, by column name. A repeated name keeps the last column. */
export type StoreRow = Record<string, StoreValue>;

/**
 * goop's encrypted database (S7, ADR 0001). Statements take positional `?` parameters, and
 * values reach the engine only as parameters, never inside the SQL text.
 */
export interface EncryptedStore {
  /** Runs one statement and drops any rows it gives. */
  run(sql: string, params?: readonly StoreValue[]): void;
  /** Runs one statement and returns its rows. */
  query(sql: string, params?: readonly StoreValue[]): StoreRow[];
  /**
   * Runs `work` in one transaction: committed when it returns, rolled back when it throws.
   * `work` is synchronous; transactions do not nest.
   */
  transaction<T>(work: () => T): T;
  /** Closes the database. Closing twice does nothing; any other call afterwards throws. */
  close(): void;
}

/** Opens encrypted stores with one engine. */
export interface EncryptedStoreEngine {
  /**
   * Opens or creates the database at `path` with the 32-byte data key (S1), and proves the key
   * with a first read. A wrong key or a changed file throws `StoreOpenError`.
   */
  open(path: string, key: DataKey): EncryptedStore;
}
