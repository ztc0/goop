// The private channel between `goop` and `goop daemon` (T17): JSON-RPC 2.0 messages and, later,
// the socket and pipe that carry them. The rest of goop imports only this entry (`@/shared/ipc`).

export {
  encodeMessage,
  JSON_RPC_ERRORS,
  MAX_MESSAGE_BYTES,
  parseMessage,
} from "@/shared/ipc/model/json-rpc";
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
