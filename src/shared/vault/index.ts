// The vault: goop's data key, its envelopes, the OS key store, the encrypted store and the
// pinned native libraries it loads. The rest of goop imports only this entry (`@/shared/vault`).

// The key service (S9): setup, start and recovery over the submodules above.
export { nodeVaultFiles } from "./adapters/vault-files";
export * from "./keys";
export * from "./keystore";
export {
  KeyStoreUnavailableError,
  PassphraseRequiredError,
  VaultFileError,
  VaultStateError,
  vaultState,
} from "./model/vault-state";
export * from "./native";
export * from "./storage";
export type {
  VaultFileName,
  VaultFiles,
  VaultKeys,
  VaultPresence,
  VaultState,
} from "./types/vault";
