// Keys: the data key and its envelopes (odd/tasks/storage.md, S1-S4). Sealing is exported only
// with fresh randomness; the fixed-input seals stay inside the model for its tests.

export {
  newDataKey,
  newRecoveryKey,
  sealWithPassphrase,
  sealWithRecoveryKey,
} from "@/shared/vault/keys/adapters/random-keys";
export {
  EnvelopeFormatError,
  EnvelopeOpenError,
  KeyInputError,
  openPassphraseEnvelope,
  openRecoveryEnvelope,
} from "@/shared/vault/keys/model/key-envelope";
export type { Bytes, DataKey, EnvelopeKind } from "@/shared/vault/keys/types/key-envelope";
