import { describe, expect, test } from "bun:test";
import { connectProblem, pingOutcome } from "@/interfaces/tui/model/ping";
import { JSON_RPC_ERRORS } from "@/shared/ipc";

describe("pingOutcome", () => {
  test("`pong` is the answer, on stdout with exit 0", () => {
    expect(pingOutcome({ kind: "result", result: "pong" })).toEqual({
      exitCode: 0,
      stdout: "goop daemon answered: pong",
    });
  });

  test("another result is an unexpected answer, never shown", () => {
    expect(pingOutcome({ kind: "result", result: "\u001b[2J" })).toEqual({
      exitCode: 1,
      stderr: "goop daemon gave an unexpected answer.",
    });
  });

  test("an error is a refusal, without its text", () => {
    expect(pingOutcome({ kind: "error", error: { ...JSON_RPC_ERRORS.methodNotFound } })).toEqual({
      exitCode: 1,
      stderr: "goop daemon refused the ping.",
    });
  });

  test("no answer says why, in goop's words", () => {
    expect(
      pingOutcome({ kind: "problem", line: "goop daemon sent a message goop cannot read." }),
    ).toEqual({
      exitCode: 1,
      stderr: "goop daemon sent a message goop cannot read.",
    });
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
