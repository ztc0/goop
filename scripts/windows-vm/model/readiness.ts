import type { ReadinessPolicy } from "../types/windows-vm";

/** The first install downloads and installs Windows: about 25 min, so allow 60. */
export const INSTALL_READINESS: ReadinessPolicy = { intervalMs: 10_000, timeoutMs: 3_600_000 };

/** A run boots the installed Windows: about 2 min, so allow 10. */
export const RUN_READINESS: ReadinessPolicy = { intervalMs: 5_000, timeoutMs: 600_000 };

/** Poll again, or give up once the deadline has passed. */
export function readinessDecision(
  policy: ReadinessPolicy,
  startedAt: number,
  now: number,
): "poll" | "timeout" {
  return now - startedAt >= policy.timeoutMs ? "timeout" : "poll";
}

export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
