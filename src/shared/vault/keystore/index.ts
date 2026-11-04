// Keystore: the OS envelopes of the data key (S5, S6). They share one interface,
// `OsKeyEnvelope`; T6 picks one or the passphrase.

export { dpapiEnvelope } from "./adapters/dpapi-envelope";
export { systemdCredsEnvelope } from "./adapters/systemd-creds-envelope";
export {
  OsEnvelopeOpenError,
  OsEnvelopeSealError,
  OsEnvelopeUnavailableError,
} from "./model/os-key-envelope";
export type {
  OsEnvelopeAvailability,
  OsEnvelopeUnavailable,
  OsEnvelopeUnavailableReason,
  OsKeyEnvelope,
} from "./types/os-key-envelope";
