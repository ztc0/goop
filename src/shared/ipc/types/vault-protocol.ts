// The vault methods `goop` sends to `goop daemon` (daemon-ipc S7): the daemon owns the vault, the
// TUI only asks for its state and sends the passphrase or the recovery key the user typed.

/** What the vault allows now, as the daemon tells the TUI. */
export type VaultStatus = "first-run" | "locked" | "needs-recovery" | "unlocked";

export type VaultMethod = "vault.status" | "vault.setup" | "vault.unlock" | "vault.recover";

/** The params of each vault method once they passed their checks. */
export interface VaultParams {
  "vault.status": Record<string, never>;
  "vault.setup": { passphrase: string };
  "vault.unlock": { passphrase: string };
  "vault.recover": { recoveryKey: string; passphrase: string };
}

/** The result of each vault method. */
export interface VaultResults {
  "vault.status": { state: VaultStatus };
  /** Shown to the user once; goop never stores or logs it. */
  "vault.setup": { recoveryKey: string };
  "vault.unlock": { state: "unlocked" };
  "vault.recover": { state: "unlocked" };
}

/** What `goop` makes of a vault error; nothing the daemon wrote is shown as it came. */
export type VaultFailure =
  | { kind: "wrong-secret" }
  | { kind: "wrong-state"; state: VaultStatus }
  | { kind: "key-store-unavailable" }
  | { kind: "unknown" };
