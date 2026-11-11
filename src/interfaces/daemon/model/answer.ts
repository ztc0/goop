// What the daemon answers each message with (S2). Pure: the daemon's service reads the channel
// and sends back what this returns. A reply never repeats the input, which may hold a passphrase.
import { JSON_RPC_ERRORS, type JsonRpcMessage, type ParsedMessage } from "@/shared/ipc";

/** The reply to one message, or undefined when it needs none (a notification or a response). */
export function answer(parsed: ParsedMessage): JsonRpcMessage | undefined {
  if (!parsed.ok) return { jsonrpc: "2.0", id: null, error: parsed.error };
  const message = parsed.message;
  if (!("method" in message) || !("id" in message)) return undefined;
  if (message.method === "ping") return { jsonrpc: "2.0", id: message.id, result: "pong" };
  return { jsonrpc: "2.0", id: message.id, error: { ...JSON_RPC_ERRORS.methodNotFound } };
}
