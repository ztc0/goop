// Newline-delimited JSON (S2, S4). Pure: the socket and the pipe both hand their chunks here.
// Lines are cut on the newline byte, which never occurs inside a multi-byte UTF-8 character, so a
// chunk may end anywhere. A line is decoded only once it is whole; bytes that are not UTF-8
// become U+FFFD and the message is then judged by parseMessage like any other.
import { encodeMessage, MAX_MESSAGE_BYTES } from "@/shared/ipc/model/json-rpc";
import type { FrameBatch, FrameReader } from "@/shared/ipc/types/framing";
import type { JsonRpcMessage } from "@/shared/ipc/types/json-rpc";

const NEWLINE = 0x0a;

/** A reader for one connection. Once a line is too large it reads nothing more. */
export function frameReader(): FrameReader {
  const decoder = new TextDecoder();
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let tooLarge = false;

  const take = (tail: Uint8Array): string => {
    const whole = new Uint8Array(pendingBytes + tail.length);
    let offset = 0;
    for (const part of [...pending, tail]) {
      whole.set(part, offset);
      offset += part.length;
    }
    pending = [];
    pendingBytes = 0;
    return decoder.decode(whole);
  };

  return {
    push(chunk): FrameBatch {
      const lines: string[] = [];
      let start = 0;
      while (!tooLarge) {
        const end = chunk.indexOf(NEWLINE, start);
        const size = pendingBytes + (end === -1 ? chunk.length : end) - start;
        if (size > MAX_MESSAGE_BYTES) {
          tooLarge = true;
          pending = [];
          pendingBytes = 0;
        } else if (end === -1) {
          if (start < chunk.length) {
            pending.push(chunk.slice(start));
            pendingBytes = size;
          }
          break;
        } else {
          const line = take(chunk.subarray(start, end));
          if (line.length > 0) lines.push(line);
          start = end + 1;
        }
      }
      return { lines, tooLarge };
    },
  };
}

/** One message as one line of UTF-8; refuses what encodeMessage refuses. */
export function encodeFrame(message: JsonRpcMessage): Uint8Array {
  return new TextEncoder().encode(`${encodeMessage(message)}\n`);
}
