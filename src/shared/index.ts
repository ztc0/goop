// Shared: building blocks used by two or more features.

export { dpapiEnvelope } from "./adapters/dpapi-envelope";
// The data key and its envelopes (odd/tasks/storage.md, S1-S6). Sealing is exported only
// with fresh randomness; the fixed-input seals stay inside the model for its tests. The OS
// envelopes share one interface, `OsKeyEnvelope`; T6 picks one or the passphrase.
export {
  newDataKey,
  newRecoveryKey,
  sealWithPassphrase,
  sealWithRecoveryKey,
} from "./adapters/random-keys";
// The encrypted store (S7): features depend on `EncryptedStore`; sqlite3mc is one engine.
export { type Sqlite3mcOptions, sqlite3mcEngine } from "./adapters/sqlite3mc-store";
export { systemdCredsEnvelope } from "./adapters/systemd-creds-envelope";
export { StoreError, StoreLibraryError, StoreOpenError } from "./model/encrypted-store";
export {
  EnvelopeFormatError,
  EnvelopeOpenError,
  KeyInputError,
  openPassphraseEnvelope,
  openRecoveryEnvelope,
} from "./model/key-envelope";
export {
  OsEnvelopeOpenError,
  OsEnvelopeSealError,
  OsEnvelopeUnavailableError,
} from "./model/os-key-envelope";
export type {
  EncryptedStore,
  EncryptedStoreEngine,
  StoreRow,
  StoreValue,
} from "./types/encrypted-store";
export type { Bytes, DataKey, EnvelopeKind } from "./types/key-envelope";
export type {
  OsEnvelopeAvailability,
  OsEnvelopeUnavailable,
  OsEnvelopeUnavailableReason,
  OsKeyEnvelope,
} from "./types/os-key-envelope";
