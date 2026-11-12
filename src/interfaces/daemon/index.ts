// Daemon: `goop daemon`, the service that owns the models, the queue and the database (S1, S3).

export { daemonVault } from "@/interfaces/daemon/adapters/daemon-vault";
export { answer } from "@/interfaces/daemon/model/answer";
export { respond } from "@/interfaces/daemon/services/respond";
export {
  type DaemonOutput,
  LISTENING,
  serveDaemon,
  VAULT_LINES,
} from "@/interfaces/daemon/services/serve-daemon";
export {
  VaultSecretError,
  type VaultSession,
  VaultStatusError,
  vaultSession,
} from "@/interfaces/daemon/services/vault-session";
