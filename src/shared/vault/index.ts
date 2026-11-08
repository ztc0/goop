// The vault: goop's data key, its envelopes, the OS key store, the encrypted store and the
// pinned native libraries it loads. The rest of goop imports only this entry (`@/shared/vault`).

// The key service (S9): setup, start and recovery over the submodules above.
export { nodeVaultFiles } from "@/shared/vault/adapters/vault-files";
export * from "@/shared/vault/keys";
export * from "@/shared/vault/keystore";
export {
  KeyStoreUnavailableError,
  PassphraseRequiredError,
  VaultFileError,
  VaultStateError,
  vaultState,
} from "@/shared/vault/model/vault-state";
export * from "@/shared/vault/native";
export {
  type KeyService,
  type KeyServiceOptions,
  keyService,
  type SetupResult,
} from "@/shared/vault/services/key-service";
export * from "@/shared/vault/storage";
export type {
  VaultFileName,
  VaultFiles,
  VaultKeys,
  VaultPresence,
  VaultState,
} from "@/shared/vault/types/vault";
