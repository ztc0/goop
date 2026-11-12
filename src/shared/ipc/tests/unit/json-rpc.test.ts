import { describe, expect, test } from "bun:test";
import {
  encodeMessage,
  JSON_RPC_ERRORS,
  type JsonRpcMessage,
  MAX_MESSAGE_BYTES,
  parseMessage,
} from "@/shared/ipc";

const invalid = { ok: false, error: { code: -32600, message: "Invalid Request" } } as const;
const tooLarge = { ok: false, error: { code: -32600, message: "Message too large" } } as const;
const notJson = { ok: false, error: { code: -32700, message: "Parse error" } } as const;
const json = (value: unknown) => JSON.stringify(value);

describe("parseMessage (S2, S4)", () => {
  test("reads the four kinds of message", () => {
    const request = { jsonrpc: "2.0", id: 1, method: "offers.list", params: {} } as const;
    const notification = { jsonrpc: "2.0", method: "search.progress", params: [0.4] } as const;
    const result = { jsonrpc: "2.0", id: "a", result: [{ title: "Backend dev" }] } as const;
    const failure = {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32601, message: "Method not found" },
    } as const;

    for (const message of [request, notification, result, failure]) {
      expect(parseMessage(json(message))).toEqual({ ok: true, message });
    }
  });

  test("text that is not JSON is a parse error", () => {
    expect(parseMessage("{not json")).toEqual(notJson);
    expect(parseMessage("")).toEqual(notJson);
  });

  test.each([
    ["another version", { jsonrpc: "1.0", id: 1, method: "m" }],
    ["no version", { id: 1, method: "m" }],
    ["no method", { jsonrpc: "2.0", id: 1 }],
    ["an empty method", { jsonrpc: "2.0", id: 1, method: "" }],
    ["a reserved rpc. method", { jsonrpc: "2.0", id: 1, method: "rpc.discover" }],
    ["params that are not an object or a list", { jsonrpc: "2.0", id: 1, method: "m", params: 3 }],
    ["an id that is an object", { jsonrpc: "2.0", id: {}, method: "m" }],
    ["an unknown field", { jsonrpc: "2.0", id: 1, method: "m", extra: true }],
    [
      "both result and error",
      { jsonrpc: "2.0", id: 1, result: 1, error: { code: 1, message: "x" } },
    ],
    ["an error without a message", { jsonrpc: "2.0", id: 1, error: { code: 1 } }],
    ["a batch", [{ jsonrpc: "2.0", id: 1, method: "m" }]],
    ["a plain value", 42],
  ])("a message with %s is an invalid request", (_, message) => {
    expect(parseMessage(json(message))).toEqual(invalid);
  });

  test("a message over MAX_MESSAGE_BYTES is refused before it is read, counting UTF-8 bytes", () => {
    const frame = (fill: string) => json({ jsonrpc: "2.0", method: "m", params: [fill] });
    const room = MAX_MESSAGE_BYTES - new TextEncoder().encode(frame("")).length;

    expect(parseMessage(frame("a".repeat(room))).ok).toBe(true);
    expect(parseMessage(frame("a".repeat(room + 1)))).toEqual(tooLarge);
    // "ñ" is one character but two bytes.
    expect(parseMessage(frame("ñ".repeat(Math.ceil((room + 1) / 2))))).toEqual(tooLarge);
    // Not even valid JSON is looked at once it is too large.
    expect(parseMessage("{".repeat(MAX_MESSAGE_BYTES + 1))).toEqual(tooLarge);
  });

  test("no error repeats what it received, so a secret never reaches a reply or a log", () => {
    const secret = "correct horse battery staple";
    const attempts = [
      `{"passphrase":"${secret}"`,
      json({ jsonrpc: "2.0", id: 1, method: "vault.unlock", params: { passphrase: secret }, x: 1 }),
      json({ jsonrpc: "2.0", method: "m", params: [secret.repeat(MAX_MESSAGE_BYTES)] }),
    ];
    for (const text of attempts) {
      const parsed = parseMessage(text);
      expect(parsed.ok).toBe(false);
      expect(JSON.stringify(parsed)).not.toContain(secret);
    }
  });
});

describe("encodeMessage (S2, S4)", () => {
  test("writes a message that parseMessage reads back unchanged", () => {
    const message = { jsonrpc: "2.0", id: 7, method: "offers.get", params: { id: "o-1" } } as const;
    expect(parseMessage(encodeMessage(message))).toEqual({ ok: true, message });
  });

  test("refuses to write a message over MAX_MESSAGE_BYTES", () => {
    const message = {
      jsonrpc: "2.0",
      method: "m",
      params: ["a".repeat(MAX_MESSAGE_BYTES)],
    } as const;
    expect(() => encodeMessage(message)).toThrow("Message too large");
  });

  // The types allow some of these; the other side would still refuse them, so they are never sent.
  test.each([
    ["a reserved rpc. method", { jsonrpc: "2.0", id: 1, method: "rpc.discover" }],
    ["an empty method", { jsonrpc: "2.0", method: "" }],
    ["an id that is an object", { jsonrpc: "2.0", id: {}, method: "m" }],
    ["a result that JSON drops", { jsonrpc: "2.0", id: 1, result: undefined }],
    [
      "an error code that is not an integer",
      { jsonrpc: "2.0", id: 1, error: { code: 1.5, message: "x" } },
    ],
    ["an unknown field", { jsonrpc: "2.0", method: "m", extra: true }],
  ])("refuses to write a message with %s", (_, message) => {
    expect(() => encodeMessage(message as unknown as JsonRpcMessage)).toThrow("Invalid Request");
  });
});

test("the standard error codes", () => {
  expect(JSON_RPC_ERRORS).toEqual({
    parseError: { code: -32700, message: "Parse error" },
    invalidRequest: { code: -32600, message: "Invalid Request" },
    methodNotFound: { code: -32601, message: "Method not found" },
    invalidParams: { code: -32602, message: "Invalid params" },
    internalError: { code: -32603, message: "Internal error" },
  });
});
