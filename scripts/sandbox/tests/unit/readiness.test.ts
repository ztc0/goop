import { describe, expect, test } from "bun:test";
import {
  formatElapsed,
  INSTALL_READINESS,
  RUN_READINESS,
  readinessDecision,
} from "@scripts/sandbox/model/readiness";

describe("readiness policy", () => {
  test("install polls every 10 s for up to 60 min; a run waits up to 10 min", () => {
    expect(INSTALL_READINESS).toEqual({ intervalMs: 10_000, timeoutMs: 3_600_000 });
    expect(RUN_READINESS).toEqual({ intervalMs: 5_000, timeoutMs: 600_000 });
  });

  test("keeps polling until the deadline, then times out", () => {
    expect(readinessDecision(INSTALL_READINESS, 1_000, 1_000)).toBe("poll");
    expect(readinessDecision(INSTALL_READINESS, 1_000, 3_600_999)).toBe("poll");
    expect(readinessDecision(INSTALL_READINESS, 1_000, 3_601_000)).toBe("timeout");
  });

  test("formats elapsed time in minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("0m 0s");
    expect(formatElapsed(200_999)).toBe("3m 20s");
    expect(formatElapsed(3_600_000)).toBe("60m 0s");
  });
});
