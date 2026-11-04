// Storage: the encrypted store (S7). Features depend on `EncryptedStore`; sqlite3mc is one engine.

export { type Sqlite3mcOptions, sqlite3mcEngine } from "./adapters/sqlite3mc-store";
export { StoreError, StoreLibraryError, StoreOpenError } from "./model/encrypted-store";
export type {
  EncryptedStore,
  EncryptedStoreEngine,
  StoreRow,
  StoreValue,
  SyncWork,
} from "./types/encrypted-store";
