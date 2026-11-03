import { formatElapsed, readinessDecision } from "../model/readiness";
import { passwordFromBytes } from "../model/vm-config";
import type { ReadinessPolicy, SandboxDeps } from "../types/sandbox";

export type Readiness = "ready" | "timeout" | "interrupted";

/** Exit code after Ctrl+C, as a shell reports SIGINT. */
export const INTERRUPTED_EXIT_CODE = 130;

/** Podman needs its repo-local graph root, runroot and tmpdir before any call (S3). */
export function prepareContainerStorage(deps: SandboxDeps): void {
  const { paths, files } = deps;
  for (const directory of [paths.containerStorage, paths.containerRunRoot, paths.containerTmp]) {
    files.makeDirectory(directory);
  }
}

/** Polls the probe until it passes, the policy's deadline passes or Ctrl+C. */
export async function waitUntilReady(
  deps: SandboxDeps,
  policy: ReadinessPolicy,
  probe: () => Promise<boolean>,
  onWaiting: (elapsedMs: number) => void,
): Promise<Readiness> {
  const { clock, signal } = deps;
  const startedAt = clock.now();
  for (;;) {
    if (signal.aborted) return "interrupted";
    if (await probe()) return "ready";
    if (signal.aborted) return "interrupted";
    const now = clock.now();
    if (readinessDecision(policy, startedAt, now) === "timeout") return "timeout";
    onWaiting(now - startedAt);
    await clock.sleep(policy.intervalMs, signal);
  }
}

/** Reports a readiness failure, with the tail of the container logs on timeout. */
export async function reportNotReady(
  deps: SandboxDeps,
  readiness: Readiness,
  policy: ReadinessPolicy,
  container: string,
): Promise<number> {
  const { output, podman } = deps;
  if (readiness === "interrupted") {
    output.error("Interrupted.");
    return INTERRUPTED_EXIT_CODE;
  }
  output.error(
    `Windows was not ready after ${formatElapsed(policy.timeoutMs)}. Last container logs:`,
  );
  const logs = await podman.logs(container);
  for (const line of `${logs.stdout}${logs.stderr}`.trimEnd().split("\n")) {
    output.error(line);
  }
  return 1;
}

/** The guest password, generated once and kept in .local/ with mode 0600. */
export function guestPassword(deps: SandboxDeps, create: boolean): string {
  const { paths, files } = deps;
  if (files.exists(paths.password)) return files.readText(paths.password).trim();
  if (!create) return "";
  const password = passwordFromBytes(deps.random.bytes(16));
  files.writeFile(paths.password, password, 0o600);
  return password;
}
