// Podman arguments for the Windows VM and the Debian container. The storage flags and the
// arguments every container takes in the same form live in scripts/shared/containers.

import { DEBIAN_STOP_SECONDS } from "@scripts/sandbox/model/debian-config";
import { runDirectory } from "@scripts/sandbox/model/paths";
import {
  GUEST_HOST,
  GUEST_USER,
  INSTALL_CONTAINER,
  runContainerName,
  SSH_PORT,
  STOP_TIMEOUT_SECONDS,
  WEB_PORT,
  WINDOWS_IMAGE,
} from "@scripts/sandbox/model/vm-config";
import type { SandboxPaths } from "@scripts/sandbox/types/sandbox";

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
export function installContainerArgs(paths: SandboxPaths): string[] {
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
export function runContainerArgs(paths: SandboxPaths, runId: string): string[] {
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
export function overlayArgs(paths: SandboxPaths, runId: string): string[] {
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

/** A container whose process 1 is systemd; Podman mounts /run, /tmp and the cgroups for it. */
export function systemdContainerArgs(name: string, image: string): string[] {
  return ["run", "-d", "--name", name, "--systemd=always", image];
}

export function forceRemoveArgs(name: string): string[] {
  return ["rm", "--force", "--time", String(DEBIAN_STOP_SECONDS), name];
}

/**
 * The command a user runs from the repo root to remove a container the sandbox could not.
 * The storage paths are absolute: Podman rejects relative ones with "database configuration mismatch".
 */
export function manualRemoveCommand(paths: SandboxPaths, name: string): string {
  return [
    "bun scripts/dev-env/run.ts podman",
    "--root",
    paths.containerStorage,
    "--runroot",
    paths.containerRunRoot,
    "rm -f",
    name,
  ].join(" ");
}
