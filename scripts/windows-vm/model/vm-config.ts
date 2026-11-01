/** Pinned dockur image: QEMU and the Windows installer run inside it. */
export const WINDOWS_IMAGE = "docker.io/dockurr/windows:6.06";

export const INSTALL_CONTAINER = "goop-windows-install";
export const CONTAINER_PREFIX = "goop-windows";
export const STOP_TIMEOUT_SECONDS = 120;

export const GUEST_USER = "goop";
export const GUEST_HOST = "127.0.0.1";
export const SSH_PORT = 2222;
export const WEB_PORT = 8006;
export const WEB_URL = `http://${GUEST_HOST}:${WEB_PORT}`;

/** The name of the container of one run. */
export function runContainerName(runId: string): string {
  return `${CONTAINER_PREFIX}-run-${runId}`;
}

/** A sortable run id: the UTC start time plus a random suffix. */
export function runId(date: Date, suffix: string): string {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${suffix}`;
}

/** The guest password: hex keeps it safe inside dockur's unattended XML. */
export function passwordFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
