import { describe, expect, test } from "bun:test";
import { pingDaemon } from "@/interfaces/tui/services/ping-daemon";
import {
  type Channel,
  ChannelError,
  type ChannelEvents,
  type JsonRpcMessage,
  type ParsedMessage,
} from "@/shared/ipc";

/** An in-memory channel: `reply` decides what the daemon does with each message the TUI sends. */
function fakeChannel(reply: (message: JsonRpcMessage, events: ChannelEvents) => void) {
  const state = { sent: [] as JsonRpcMessage[], closed: false };
  const channel: Channel = {
    listen: () => Promise.reject(new Error("the TUI never listens")),
    async connect(events) {
      return {
        send(message) {
          state.sent.push(message);
          reply(message, events);
        },
        close() {
          state.closed = true;
        },
      };
    },
  };
  return { channel, state };
}

function recordOutput() {
  const lines = { stdout: [] as string[], stderr: [] as string[] };
  return {
    lines,
    output: {
      print: (line: string) => lines.stdout.push(line),
      fail: (line: string) => lines.stderr.push(line),
    },
  };
}

const answerWith = (parsed: ParsedMessage) => (_: JsonRpcMessage, events: ChannelEvents) =>
  queueMicrotask(() => events.message(parsed));

describe("pingDaemon", () => {
  test("sends one ping, prints the answer, closes the connection and returns 0", async () => {
    const { channel, state } = fakeChannel(
      answerWith({ ok: true, message: { jsonrpc: "2.0", id: 1, result: "pong" } }),
    );
    const { lines, output } = recordOutput();

    expect(await pingDaemon(() => channel, output, 1000)).toBe(0);
    expect(lines).toEqual({ stdout: ["goop daemon answered: pong"], stderr: [] });
    expect(state).toEqual({ sent: [{ jsonrpc: "2.0", id: 1, method: "ping" }], closed: true });
  });

  test("no daemon: prints how to start it and returns 1, sending nothing", async () => {
    const channel: Channel = {
      listen: () => Promise.reject(new Error("the TUI never listens")),
      connect: () => Promise.reject(new ChannelError("goop daemon is not running")),
    };
    const { lines, output } = recordOutput();

    expect(await pingDaemon(() => channel, output, 1000)).toBe(1);
    expect(lines).toEqual({
      stdout: [],
      stderr: ["goop daemon is not running. Start it in another terminal with: goop daemon"],
    });
  });

  test("a channel that cannot be opened: prints its reason and returns 1", async () => {
    const { lines, output } = recordOutput();
    const openChannel = () => {
      throw new ChannelError("No runtime folder: set GOOP_RUNTIME_DIR or XDG_RUNTIME_DIR");
    };

    expect(await pingDaemon(openChannel, output, 1000)).toBe(1);
    expect(lines).toEqual({
      stdout: [],
      stderr: ["No runtime folder: set GOOP_RUNTIME_DIR or XDG_RUNTIME_DIR"],
    });
  });

  test("no answer in time: says so, closes the connection and returns 1", async () => {
    const { channel, state } = fakeChannel(() => {});
    const { lines, output } = recordOutput();

    expect(await pingDaemon(() => channel, output, 20)).toBe(1);
    expect(lines).toEqual({ stdout: [], stderr: ["goop daemon did not answer within 20 ms."] });
    expect(state.closed).toBe(true);
  });

  test("the daemon closes the connection before it answers: says so and returns 1", async () => {
    const { channel } = fakeChannel((_, events) => queueMicrotask(() => events.close()));
    const { lines, output } = recordOutput();

    expect(await pingDaemon(() => channel, output, 1000)).toBe(1);
    expect(lines).toEqual({
      stdout: [],
      stderr: ["goop daemon closed the connection before it answered."],
    });
  });

  test("waits past messages that are not the answer", async () => {
    const { channel } = fakeChannel((_, events) =>
      queueMicrotask(() => {
        events.message({ ok: true, message: { jsonrpc: "2.0", method: "progress" } });
        events.message({ ok: true, message: { jsonrpc: "2.0", id: 1, result: "pong" } });
      }),
    );
    const { lines, output } = recordOutput();

    expect(await pingDaemon(() => channel, output, 1000)).toBe(0);
    expect(lines).toEqual({ stdout: ["goop daemon answered: pong"], stderr: [] });
  });
});
