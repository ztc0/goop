// The private channel between `goop` and `goop daemon` (T17): JSON-RPC 2.0 messages, their
// newline-delimited framing and the channel that carries them. The rest of goop imports only this
// entry (`@/shared/ipc`).

export { unixSocketChannel } from "@/shared/ipc/adapters/unix-socket-channel";
export { encodeFrame, frameReader } from "@/shared/ipc/model/framing";
export {
  encodeMessage,
  JSON_RPC_ERRORS,
  MAX_MESSAGE_BYTES,
  parseMessage,
} from "@/shared/ipc/model/json-rpc";
export {
  ChannelError,
  MAX_SOCKET_PATH_BYTES,
  runtimeFolder,
  runtimeFolderProblem,
  SOCKET_FILE,
  socketPath,
} from "@/shared/ipc/model/runtime-folder";
export {
  isVaultMethod,
  MAX_PASSPHRASE_CHARS,
  MAX_RECOVERY_KEY_CHARS,
  parseVaultParams,
  readVaultFailure,
  readVaultResult,
  VAULT_ERRORS,
  VAULT_METHODS,
  wrongStateError,
} from "@/shared/ipc/model/vault-protocol";
export type {
  Channel,
  ChannelConnection,
  ChannelEvents,
  ChannelListener,
} from "@/shared/ipc/types/channel";
export type { FrameBatch, FrameReader } from "@/shared/ipc/types/framing";
export type {
  JsonRpcErrorObject,
  JsonRpcFailure,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccess,
  ParsedMessage,
} from "@/shared/ipc/types/json-rpc";
export type { FolderFacts } from "@/shared/ipc/types/runtime-folder";
export type {
  VaultFailure,
  VaultMethod,
  VaultParams,
  VaultResults,
  VaultStatus,
} from "@/shared/ipc/types/vault-protocol";
