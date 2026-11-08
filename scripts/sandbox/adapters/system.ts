import type { Clock, RandomSource } from "../types/sandbox";

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

export const cryptoRandom: RandomSource = {
  bytes: (count) => crypto.getRandomValues(new Uint8Array(count)),
};
