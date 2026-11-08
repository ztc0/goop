import { join } from "node:path";
import type { ReadinessPolicy, SandboxPaths } from "@scripts/sandbox/types/sandbox";
import type { ExecOptions } from "@scripts/shared/containers";

/** The image `sandbox:install debian` builds (S2); bump the tag when the Containerfile changes. */
export const DEBIAN_IMAGE = "localhost/goop-sandbox-debian:2";
export const DEBIAN_PREFIX = "goop-debian";
/** The non-root user, with the UID the Containerfile gives it. */
export const DEBIAN_USER = "goop";
export const DEBIAN_UID = 1000;
/** Where --copy puts files; the Containerfile creates it owned by goop. */
export const DEBIAN_WORKDIR = "/home/goop/goop";
/** Seconds systemd gets to shut down before the container is killed. */
export const DEBIAN_STOP_SECONDS = 10;

/** systemd boots in seconds; the probe itself waits up to 30 s per try. */
export const DEBIAN_READINESS: ReadinessPolicy = { intervalMs: 1_000, timeoutMs: 120_000 };

/** Waits for the boot to finish; `timeout` keeps a stuck boot from blocking the poll forever. */
export const SYSTEMD_READY_CHECK = ["timeout", "30", "systemctl", "is-system-running", "--wait"];

export function debianContainerName(runId: string): string {
  return `${DEBIAN_PREFIX}-run-${runId}`;
}

export function debianResultsDirectory(paths: SandboxPaths, runId: string): string {
  return join(paths.debianResults, runId);
}

/** The boot is over: `running`, or `degraded` when a unit failed but systemd is up. */
export function isSystemdUp(output: string): boolean {
  const state = output.trim().split("\n").at(-1)?.trim();
  return state === "running" || state === "degraded";
}

/**
 * As goop in the copy folder. `podman exec` opens no login session, so the runtime dir and
 * bus of goop's lingering user manager are set by hand for `systemctl --user`.
 */
function userOptions(): ExecOptions {
  const runtime = `/run/user/${DEBIAN_UID}`;
  return {
    user: DEBIAN_USER,
    workdir: DEBIAN_WORKDIR,
    env: { XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus` },
  };
}

/** The user's command: `bash -lc` as goop, its output streamed to the terminal. */
export function userCommand(command: string): { command: string[]; options: ExecOptions } {
  return { command: ["bash", "-lc", command], options: { ...userOptions(), stream: true } };
}

/** The interactive shell of `run debian` without a command: a bash login shell as goop. */
export function userShell(): { command: string[]; options: ExecOptions } {
  return { command: ["bash", "-l"], options: { ...userOptions(), interactive: true } };
}
