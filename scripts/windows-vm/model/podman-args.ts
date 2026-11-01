import type { WindowsVmPaths } from "../types/windows-vm";
import { runDirectory } from "./paths";
import {
  CONTAINER_PREFIX,
  GUEST_HOST,
  GUEST_USER,
  INSTALL_CONTAINER,
  runContainerName,
  SSH_PORT,
  STOP_TIMEOUT_SECONDS,
  WEB_PORT,
  WINDOWS_IMAGE,
} from "./vm-config";

/** Global flags that keep images, containers and temporary files inside the repo (S3). */
export function podmanGlobalArgs(paths: WindowsVmPaths): string[] {
  return [
    "--root",
    paths.containerStorage,
    "--runroot",
    paths.containerRunRoot,
    "--tmpdir",
    paths.containerTmp,
  ];
}

/**
 * Environment of every podman call. The password travels here, read by `-e PASSWORD`,
 * so it never appears in argv.
 */
export function podmanEnvironment(
  paths: WindowsVmPaths,
  password?: string,
): Record<string, string> {
  return password === undefined
    ? { TMPDIR: paths.containerTmp }
    : { TMPDIR: paths.containerTmp, PASSWORD: password };
}

/** Devices, Windows settings and ports shared by the install and every run. */
function vmOptions(): string[] {
  const env = [
    "VERSION=11l",
    "DISK_FMT=qcow2",
    "RAM_SIZE=8G",
    "CPU_CORES=4",
    "DISK_SIZE=64G",
    `USERNAME=${GUEST_USER}`,
    "PASSWORD",
    "USER_PORTS=22",
    "LOG=Y",
  ];
  return [
    "--device",
    "/dev/kvm",
    "--device",
    "/dev/net/tun",
    "--cap-add",
    "NET_ADMIN",
    "--stop-timeout",
    String(STOP_TIMEOUT_SECONDS),
    ...env.flatMap((entry) => ["-e", entry]),
    "-p",
    `${GUEST_HOST}:${SSH_PORT}:22`,
    "-p",
    `${GUEST_HOST}:${WEB_PORT}:${WEB_PORT}`,
  ];
}

/** The install container: kept after it stops, writing straight into the base. */
export function installContainerArgs(paths: WindowsVmPaths): string[] {
  return [
    "run",
    "-d",
    "--name",
    INSTALL_CONTAINER,
    ...vmOptions(),
    "-v",
    `${paths.base}:/storage`,
    "-v",
    `${paths.oem}:/oem`,
    WINDOWS_IMAGE,
  ];
}

/** A run: `--rm` container over the throwaway storage, with the base read-only (S5). */
export function runContainerArgs(paths: WindowsVmPaths, runId: string): string[] {
  return [
    "run",
    "-d",
    "--rm",
    "--name",
    runContainerName(runId),
    ...vmOptions(),
    "-v",
    `${runDirectory(paths, runId)}:/storage`,
    "-v",
    `${paths.base}:/base:ro`,
    WINDOWS_IMAGE,
  ];
}

/** qemu-img from the same image creates the overlay; its backing path resolves at /base. */
export function overlayArgs(paths: WindowsVmPaths, runId: string): string[] {
  return [
    "run",
    "--rm",
    "--entrypoint",
    "qemu-img",
    "-v",
    `${paths.base}:/base:ro`,
    "-v",
    `${runDirectory(paths, runId)}:/storage`,
    WINDOWS_IMAGE,
    "create",
    "-f",
    "qcow2",
    "-F",
    "qcow2",
    "-b",
    "/base/data.qcow2",
    "/storage/data.qcow2",
  ];
}

export function stopArgs(name: string): string[] {
  return ["stop", "-t", String(STOP_TIMEOUT_SECONDS), name];
}

export function removeArgs(name: string): string[] {
  return ["rm", name];
}

export function logsArgs(name: string): string[] {
  return ["logs", "--tail", "50", name];
}

export function listRunningArgs(): string[] {
  return ["ps", "--filter", `name=${CONTAINER_PREFIX}`, "--format", "{{.Names}}\t{{.Status}}"];
}
