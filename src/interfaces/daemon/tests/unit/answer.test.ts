import { describe, expect, test } from "bun:test";
import { answer } from "@/interfaces/daemon/model/answer";
import { JSON_RPC_ERRORS, parseMessage } from "@/shared/ipc";

describe("answer", () => {
  test("`ping` gets `pong`, with the request's id", () => {
    expect(answer({ ok: true, message: { jsonrpc: "2.0", id: 7, method: "ping" } })).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: "pong",
    });
    expect(answer({ ok: true, message: { jsonrpc: "2.0", id: "a", method: "ping" } })).toEqual({
      jsonrpc: "2.0",
      id: "a",
      result: "pong",
    });
  });

  test("an unknown method gets `Method not found` with the request's id, never its name", () => {
    const reply = answer({
      ok: true,
      message: { jsonrpc: "2.0", id: 3, method: "unlock-hunter2", params: ["hunter2"] },
    });

    expect(reply).toEqual({ jsonrpc: "2.0", id: 3, error: { ...JSON_RPC_ERRORS.methodNotFound } });
    expect(JSON.stringify(reply)).not.toContain("hunter2");
  });

  test("a notification gets no reply, even `ping`", () => {
    expect(answer({ ok: true, message: { jsonrpc: "2.0", method: "ping" } })).toBeUndefined();
    expect(answer({ ok: true, message: { jsonrpc: "2.0", method: "other" } })).toBeUndefined();
  });

  test("a response sent to the daemon gets no reply", () => {
    expect(answer({ ok: true, message: { jsonrpc: "2.0", id: 1, result: "x" } })).toBeUndefined();
    expect(
      answer({ ok: true, message: { jsonrpc: "2.0", id: 1, error: { code: 1, message: "x" } } }),
    ).toBeUndefined();
  });

  test("an invalid message gets its error with id null, never its text", () => {
    const parsed = parseMessage('{"jsonrpc":"2.0","id":1,"method":"ping","secret":"hunter2"}');
    const reply = answer(parsed);

    expect(reply).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { ...JSON_RPC_ERRORS.invalidRequest },
    });
    expect(JSON.stringify(reply)).not.toContain("hunter2");
    expect(answer(parseMessage("hunter2"))).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { ...JSON_RPC_ERRORS.parseError },
    });
  });
});
