import { describe, expect, test } from "bun:test";
import { encodeFrame, frameReader, MAX_MESSAGE_BYTES, parseMessage } from "@/shared/ipc";

const bytes = (text: string) => new TextEncoder().encode(text);
const request = {
  jsonrpc: "2.0",
  id: 1,
  method: "vault.unlock",
  params: { key: "ñandú" },
} as const;
const line = JSON.stringify(request);

describe("frameReader (S2, S4)", () => {
  test("yields a line once its newline arrives", () => {
    const reader = frameReader();
    expect(reader.push(bytes(line))).toEqual({ lines: [], tooLarge: false });
    expect(reader.push(bytes("\n"))).toEqual({ lines: [line], tooLarge: false });
  });

  test("yields every line of a chunk that holds several", () => {
    const reader = frameReader();
    expect(reader.push(bytes(`${line}\n{"a":1}\n{"b"`))).toEqual({
      lines: [line, '{"a":1}'],
      tooLarge: false,
    });
    expect(reader.push(bytes(":2}\n"))).toEqual({ lines: ['{"b":2}'], tooLarge: false });
  });

  test("joins a line split anywhere, even inside a multi-byte character", () => {
    const frame = bytes(`${line}\n`);
    for (let cut = 1; cut < frame.length; cut++) {
      const reader = frameReader();
      const first = reader.push(frame.slice(0, cut));
      const second = reader.push(frame.slice(cut));
      expect([...first.lines, ...second.lines]).toEqual([line]);
    }
    // One byte at a time.
    const reader = frameReader();
    const lines = [...frame].flatMap((byte) => reader.push(Uint8Array.of(byte)).lines);
    expect(lines).toEqual([line]);
  });

  test("ignores empty lines", () => {
    expect(frameReader().push(bytes(`\n\n${line}\n\n`))).toEqual({
      lines: [line],
      tooLarge: false,
    });
  });

  test("a line of MAX_MESSAGE_BYTES is fine; one byte more is too large", () => {
    const fits = "ñ".repeat(MAX_MESSAGE_BYTES / 2);
    const pending = frameReader();
    expect(pending.push(bytes(fits))).toEqual({ lines: [], tooLarge: false });
    expect(pending.push(bytes("\n"))).toEqual({ lines: [fits], tooLarge: false });

    const growing = frameReader();
    expect(growing.push(bytes(fits))).toEqual({ lines: [], tooLarge: false });
    expect(growing.push(bytes("a"))).toEqual({ lines: [], tooLarge: true });

    expect(frameReader().push(bytes(`${fits}a\n`))).toEqual({ lines: [], tooLarge: true });
  });

  test("keeps the lines before a line that is too large, and nothing after it", () => {
    const reader = frameReader();
    const big = "a".repeat(MAX_MESSAGE_BYTES + 1);
    expect(reader.push(bytes(`${line}\n${big}\n${line}\n`))).toEqual({
      lines: [line],
      tooLarge: true,
    });
    expect(reader.push(bytes(`${line}\n`))).toEqual({ lines: [], tooLarge: true });
  });
});

describe("encodeFrame (S2, S4)", () => {
  test("writes one message as one line that the reader and parseMessage read back", () => {
    const frame = encodeFrame(request);
    expect(new TextDecoder().decode(frame)).toBe(`${line}\n`);
    const { lines } = frameReader().push(frame);
    expect(lines.map(parseMessage)).toEqual([{ ok: true, message: request }]);
  });

  test("refuses what encodeMessage refuses", () => {
    const big = { jsonrpc: "2.0", method: "m", params: ["a".repeat(MAX_MESSAGE_BYTES)] } as const;
    expect(() => encodeFrame(big)).toThrow("Message too large");
    expect(() => encodeFrame({ jsonrpc: "2.0", method: "" })).toThrow("Invalid Request");
  });
});
