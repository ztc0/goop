import type { Bytes, DataKey } from "@/shared/vault/keys";

/** The files of one vault folder (for example `<GOOP_HOME>/data/`). */
export type VaultFileName = "goop.db" | "data-key.os" | "data-key.passphrase" | "data-key.recovery";

/** Which files of the vault exist: the decision to create a data key is taken from them (L32). */
export interface VaultPresence {
  store: boolean;
  osEnvelope: boolean;
  passphraseEnvelope: boolean;
  recoveryEnvelope: boolean;
}

/**
 * What the vault folder allows (S9, L32):
 * - `first-run`: no store and no envelope, so setup may create the data key.
 * - `ready`: the store and an OS or passphrase envelope, so start opens them.
 * - `needs-recovery`: the store without an OS or passphrase envelope that opens, and a recovery
 *   envelope, so the user types the recovery key.
 * - `needs-backup`: the store and no envelope at all; only a backup can help.
 * - `store-missing`: envelopes without a store; goop warns and touches nothing.
 */
export type VaultState =
  | "first-run"
  | "ready"
  | "needs-recovery"
  | "needs-backup"
  | "store-missing";

/** The file system calls of the vault, kept thin so every decision is testable. */
export interface VaultFiles {
  /** The full path of a vault file, for the store engine. */
  path(name: VaultFileName): string;
  exists(name: VaultFileName): Promise<boolean>;
  /** The file's bytes, or undefined when there is no such file. */
  read(name: VaultFileName): Promise<Bytes | undefined>;
  /**
   * Writes the whole file atomically (a 0600 temporary file in the folder, then renamed), creating
   * the 0700 folder when needed. Without `replace`, an existing file is refused and kept.
   */
  write(name: VaultFileName, bytes: Uint8Array, options: { replace: boolean }): Promise<void>;
  /** Removes the file; nothing happens when it is already gone. */
  remove(name: VaultFileName): Promise<void>;
}

/** The data key and its recovery and passphrase envelopes (`@/shared/vault/keys`). */
export interface VaultKeys {
  newDataKey(): DataKey;
  newRecoveryKey(): string;
  sealWithRecoveryKey(dek: DataKey, recoveryKey: string): Promise<Bytes>;
  sealWithPassphrase(dek: DataKey, passphrase: string): Promise<Bytes>;
  openRecoveryEnvelope(envelope: Uint8Array, recoveryKey: string): Promise<DataKey>;
  openPassphraseEnvelope(envelope: Uint8Array, passphrase: string): Promise<DataKey>;
}
