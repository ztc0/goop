// The vault's state table and errors (S9, L32). Whether goop may create a data key is decided
// from the files that exist, never from a failed open: a store without envelopes is never a
// first run. No error here carries a key, a passphrase or a recovery key.
import type { OsEnvelopeUnavailableReason } from "@/shared/vault/keystore";
import type { VaultFileName, VaultPresence, VaultState } from "../types/vault";

export const STORE_FILE: VaultFileName = "goop.db";
export const OS_ENVELOPE_FILE: VaultFileName = "data-key.os";
export const PASSPHRASE_ENVELOPE_FILE: VaultFileName = "data-key.passphrase";
export const RECOVERY_ENVELOPE_FILE: VaultFileName = "data-key.recovery";

export function vaultState(presence: VaultPresence): VaultState {
  const envelopes = presence.osEnvelope || presence.passphraseEnvelope || presence.recoveryEnvelope;
  if (!presence.store) return envelopes ? "store-missing" : "first-run";
  if (presence.osEnvelope || presence.passphraseEnvelope) return "ready";
  return presence.recoveryEnvelope ? "needs-recovery" : "needs-backup";
}

const PROBLEMS: Record<VaultState, string> = {
  "first-run": "the vault has no data key yet; run setup first",
  ready: "the vault already has a data key; goop never creates a new data key over existing data",
  "needs-recovery":
    "the OS or passphrase envelope of the data key is missing or cannot be opened here; enter the recovery key",
  "needs-backup":
    "the store exists but every envelope of its data key is missing; restore the vault folder from a backup. goop never creates a new data key over existing data",
  "store-missing":
    "the envelopes of the data key exist but the store is missing; restore the store from a backup. goop changed nothing",
};

/** The operation is not allowed in the vault's current state; `state` says what to do next. */
export class VaultStateError extends Error {
  override name = "VaultStateError";
  readonly state: VaultState;
  constructor(state: VaultState, operation: "set up" | "start" | "recover") {
    super(`goop cannot ${operation} the vault: ${PROBLEMS[state]}.`);
    this.state = state;
  }
}

/** The OS key store did not answer or cannot be used now. Never a lost key (S9). */
export class KeyStoreUnavailableError extends Error {
  override name = "KeyStoreUnavailableError";
  readonly reason: OsEnvelopeUnavailableReason;
  constructor(reason: OsEnvelopeUnavailableReason) {
    super(
      `The OS key store is unavailable right now (${reason}), so goop will try again later. The data key is not lost.`,
    );
    this.reason = reason;
  }
}

/** The data key needs a passphrase envelope, and no passphrase was given (S4). */
export class PassphraseRequiredError extends Error {
  override name = "PassphraseRequiredError";
  constructor(detail: string) {
    super(`A passphrase is needed: ${detail}.`);
  }
}

/** A vault file that is missing, already there or not an envelope. */
export class VaultFileError extends Error {
  override name = "VaultFileError";
  constructor(name: VaultFileName, problem: string) {
    super(`The vault file ${name} ${problem}.`);
  }
}
