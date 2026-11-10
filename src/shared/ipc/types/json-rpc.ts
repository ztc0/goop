// The JSON-RPC 2.0 messages the TUI and the daemon exchange (S2). One message per frame; batches
// are not used.

/** Matches a request to its response. */
export type JsonRpcId = string | number;

/** Asks for something and waits for the response with the same id. */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: Readonly<Record<string, unknown>> | readonly unknown[];
}

/** Says something and waits for nothing, such as a progress update. */
export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Readonly<Record<string, unknown>> | readonly unknown[];
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  /** Null when the request's id could not be read. */
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure;

/** A read message, or the error to answer with. The error never repeats the input. */
export type ParsedMessage =
  | { ok: true; message: JsonRpcMessage }
  | { ok: false; error: JsonRpcErrorObject };
