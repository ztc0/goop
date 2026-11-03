import { writeSync } from "node:fs";
import type { Clock, Output, RandomSource } from "../types/sandbox";

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", done);
    }),
};

/** Synchronous writes keep our lines in order with the guest output streamed to the same fds. */
export const terminalOutput: Output = {
  info: (line) => {
    writeSync(1, `${line}\n`);
  },
  error: (line) => {
    writeSync(2, `${line}\n`);
  },
};

export const cryptoRandom: RandomSource = {
  bytes: (count) => crypto.getRandomValues(new Uint8Array(count)),
};
