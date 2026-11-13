// Keystore: the OS envelopes of the data key (S5, S6). They share one interface,
// `OsKeyEnvelope`; T6 picks one or the passphrase.

export { dpapiEnvelope } from "@/shared/vault/keystore/adapters/dpapi-envelope";
export {
  INSECURE_DEV_KEY_FILE,
  type InsecureDevKeyOptions,
  InsecureDevKeyRefusedError,
  insecureDevKeyEnvelope,
} from "@/shared/vault/keystore/adapters/insecure-dev-key-envelope";
export { noOsKeyEnvelope } from "@/shared/vault/keystore/adapters/no-os-envelope";
export { systemdCredsEnvelope } from "@/shared/vault/keystore/adapters/systemd-creds-envelope";
export {
  OsEnvelopeOpenError,
  OsEnvelopeSealError,
  OsEnvelopeUnavailableError,
} from "@/shared/vault/keystore/model/os-key-envelope";
export type {
  OsEnvelopeAvailability,
  OsEnvelopeUnavailable,
  OsEnvelopeUnavailableReason,
  OsKeyEnvelope,
} from "@/shared/vault/keystore/types/os-key-envelope";
