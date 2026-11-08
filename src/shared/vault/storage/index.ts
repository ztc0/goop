// Storage: the encrypted store (S7). Features depend on `EncryptedStore`; sqlite3mc is one engine.

export {
  type Sqlite3mcOptions,
  sqlite3mcEngine,
} from "@/shared/vault/storage/adapters/sqlite3mc-store";
export {
  StoreError,
  StoreLibraryError,
  StoreOpenError,
} from "@/shared/vault/storage/model/encrypted-store";
export type {
  EncryptedStore,
  EncryptedStoreEngine,
  StoreRow,
  StoreValue,
  SyncWork,
} from "@/shared/vault/storage/types/encrypted-store";
