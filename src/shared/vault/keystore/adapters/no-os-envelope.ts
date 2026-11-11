// No OS key store (goop S25): while developing, goop never touches the real TPM2 or DPAPI, so the
// key service seals the data key with the passphrase instead. It holds no key and stores nothing.
import { OsEnvelopeUnavailableError } from "@/shared/vault/keystore/model/os-key-envelope";
import type {
  OsEnvelopeUnavailable,
  OsKeyEnvelope,
} from "@/shared/vault/keystore/types/os-key-envelope";

/** An OS key store that is never available; `message` says why, and is safe to show. */
export function noOsKeyEnvelope(message: string): OsKeyEnvelope {
  const unavailable: OsEnvelopeUnavailable = { available: false, reason: "turned-off", message };
  return {
    availability: async () => unavailable,
    seal: async () => {
      throw new OsEnvelopeUnavailableError(unavailable);
    },
    open: async () => {
      throw new OsEnvelopeUnavailableError(unavailable);
    },
  };
}
