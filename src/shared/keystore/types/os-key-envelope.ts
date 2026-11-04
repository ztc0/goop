import type { Bytes, DataKey } from "@/shared/keys";

/**
 * Why this machine cannot use its OS key store. The caller then uses the passphrase envelope
 * (S4), except for `busy`: the key store works but did not answer for a while (DPAPI after
 * another user's logon), so the caller tries again later.
 */
export type OsEnvelopeUnavailableReason =
  | "unsupported-platform"
  | "missing-tool"
  | "old-version"
  | "no-tpm2"
  | "busy";

export interface OsEnvelopeUnavailable {
  available: false;
  reason: OsEnvelopeUnavailableReason;
  /** Safe to show and to log: it never holds a key, a credential or raw tool output. */
  message: string;
}

export type OsEnvelopeAvailability = { available: true } | OsEnvelopeUnavailable;

/** The OS key store that seals the data key for this user on this machine (S5, S6). */
export interface OsKeyEnvelope {
  /** Whether this machine can use it. It never seals or opens anything. */
  availability(): Promise<OsEnvelopeAvailability>;
  /** The data key sealed for this user on this machine. */
  seal(dek: DataKey): Promise<Bytes>;
  /**
   * The data key back. Rejects with `OsEnvelopeOpenError` when the sealed bytes were changed or
   * belong to another user, machine or name, and with `OsEnvelopeUnavailableError` when the key
   * store cannot be used, which never means the data key is lost (S9).
   */
  open(sealed: Bytes): Promise<DataKey>;
}
