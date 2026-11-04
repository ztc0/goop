// Shared: building blocks used by two or more features.

// The data key and its envelopes (odd/tasks/storage.md, S1-S5). Sealing is exported only
// with fresh randomness; the fixed-input seals stay inside the model for its tests. The OS
// envelopes share one interface, `OsKeyEnvelope`; T6 picks one or the passphrase.
export {
  newDataKey,
  newRecoveryKey,
  sealWithPassphrase,
  sealWithRecoveryKey,
} from "./adapters/random-keys";
export { systemdCredsEnvelope } from "./adapters/systemd-creds-envelope";
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
export type { Bytes, DataKey, EnvelopeKind } from "./types/key-envelope";
export type {
  OsEnvelopeAvailability,
  OsEnvelopeUnavailable,
  OsEnvelopeUnavailableReason,
  OsKeyEnvelope,
} from "./types/os-key-envelope";
