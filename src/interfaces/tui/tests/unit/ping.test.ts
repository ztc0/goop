import { describe, expect, test } from "bun:test";
import { connectProblem, PING, pingReply } from "@/interfaces/tui/model/ping";
import { JSON_RPC_ERRORS } from "@/shared/ipc";

describe("PING", () => {
  test("is a JSON-RPC request with an id, so the daemon answers it", () => {
    expect(PING).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });
  });
});

describe("pingReply", () => {
  test("`pong` to our id is the answer, on stdout with exit 0", () => {
    expect(pingReply({ ok: true, message: { jsonrpc: "2.0", id: 1, result: "pong" } })).toEqual({
      exitCode: 0,
      stdout: "goop daemon answered: pong",
    });
  });

  test("another result to our id is an unexpected answer, never shown", () => {
    expect(
      pingReply({ ok: true, message: { jsonrpc: "2.0", id: 1, result: "\u001b[2J" } }),
    ).toEqual({ exitCode: 1, stderr: "goop daemon gave an unexpected answer." });
  });

  test("an error to our id is a refusal, without its text", () => {
    expect(
      pingReply({
        ok: true,
        message: { jsonrpc: "2.0", id: 1, error: { ...JSON_RPC_ERRORS.methodNotFound } },
      }),
    ).toEqual({ exitCode: 1, stderr: "goop daemon refused the ping." });
  });

  test("an invalid message is an answer goop cannot read", () => {
    expect(pingReply({ ok: false, error: { ...JSON_RPC_ERRORS.parseError } })).toEqual({
      exitCode: 1,
      stderr: "goop daemon sent a message goop cannot read.",
    });
  });

  test("a response to another id, a request or a notification is not the answer", () => {
    expect(
      pingReply({ ok: true, message: { jsonrpc: "2.0", id: 2, result: "pong" } }),
    ).toBeUndefined();
    expect(
      pingReply({ ok: true, message: { jsonrpc: "2.0", id: 1, method: "ping" } }),
    ).toBeUndefined();
    expect(
      pingReply({ ok: true, message: { jsonrpc: "2.0", method: "progress" } }),
    ).toBeUndefined();
  });
});

describe("connectProblem", () => {
  test("no daemon: says how to start it, since goop never starts it", () => {
    expect(connectProblem("goop daemon is not running")).toBe(
      "goop daemon is not running. Start it in another terminal with: goop daemon",
    );
  });

  test("any other problem is shown as the channel names it", () => {
    expect(connectProblem("The runtime folder belongs to another user: /run/x")).toBe(
      "The runtime folder belongs to another user: /run/x",
    );
  });
});
