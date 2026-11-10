// The private channel between `goop` and `goop daemon` (T17): JSON-RPC 2.0 messages, their
// newline-delimited framing and the channel that carries them. The rest of goop imports only this
// entry (`@/shared/ipc`).

export { encodeFrame, frameReader } from "@/shared/ipc/model/framing";
export {
  encodeMessage,
  JSON_RPC_ERRORS,
  MAX_MESSAGE_BYTES,
  parseMessage,
} from "@/shared/ipc/model/json-rpc";
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
