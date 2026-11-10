// Reading and writing JSON-RPC 2.0 messages (S2, S4). Pure: no socket or pipe here, so the same
// rules hold on every channel (S8). Everything that arrives is untrusted: the size is checked
// before the text is parsed, the shape is checked with zod, and no error repeats the input, which
// may hold a passphrase.
import { z } from "zod";
import type {
  JsonRpcErrorObject,
  JsonRpcMessage,
  ParsedMessage,
} from "@/shared/ipc/types/json-rpc";

/** The largest message, in UTF-8 bytes, either side reads or writes. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

export const JSON_RPC_ERRORS = {
  parseError: { code: -32700, message: "Parse error" },
  invalidRequest: { code: -32600, message: "Invalid Request" },
  methodNotFound: { code: -32601, message: "Method not found" },
  invalidParams: { code: -32602, message: "Invalid params" },
  internalError: { code: -32603, message: "Internal error" },
} as const satisfies Record<string, JsonRpcErrorObject>;

const TOO_LARGE: JsonRpcErrorObject = { code: -32600, message: "Message too large" };

const version = z.literal("2.0");
const id = z.union([z.string(), z.number()]);
// Names starting with "rpc." are reserved by JSON-RPC 2.0.
const method = z
  .string()
  .min(1)
  .refine((name) => !name.startsWith("rpc."));
const params = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional();
const errorObject = z.strictObject({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});

const messageSchema = z.union([
  z.strictObject({ jsonrpc: version, id, method, params }),
  z.strictObject({ jsonrpc: version, method, params }),
  z.strictObject({ jsonrpc: version, id: id.nullable(), result: z.unknown() }),
  z.strictObject({ jsonrpc: version, id: id.nullable(), error: errorObject }),
]);

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** Reads one message, or names the JSON-RPC error to answer with. */
export function parseMessage(text: string): ParsedMessage {
  if (byteLength(text) > MAX_MESSAGE_BYTES) return { ok: false, error: { ...TOO_LARGE } };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: { ...JSON_RPC_ERRORS.parseError } };
  }
  const parsed = messageSchema.safeParse(data);
  if (!parsed.success) return { ok: false, error: { ...JSON_RPC_ERRORS.invalidRequest } };
  return { ok: true, message: parsed.data as JsonRpcMessage };
}

/** Writes one message; refuses one the other side would refuse as too large. */
export function encodeMessage(message: JsonRpcMessage): string {
  const text = JSON.stringify(message);
  if (byteLength(text) > MAX_MESSAGE_BYTES) throw new Error(TOO_LARGE.message);
  return text;
}
