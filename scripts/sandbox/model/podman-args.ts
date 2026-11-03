import { dirname } from "node:path";
import type { ExecOptions, SandboxPaths } from "../types/sandbox";
import { DEBIAN_STOP_SECONDS } from "./debian-config";
import { runDirectory } from "./paths";
import {
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
export function podmanGlobalArgs(paths: SandboxPaths): string[] {
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
export function podmanEnvironment(paths: SandboxPaths, password?: string): Record<string, string> {
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

export function removeArgs(name: string): string[] {
  return ["rm", name];
}

export function logsArgs(name: string): string[] {
  return ["logs", "--tail", "50", name];
}

export function listRunningArgs(prefix: string): string[] {
  return ["ps", "--filter", `name=${prefix}`, "--format", "{{.Names}}\t{{.Status}}"];
}

/** The build context is the Containerfile's own folder, so nothing else in the repo is sent. */
export function buildArgs(tag: string, containerfile: string): string[] {
  return ["build", "--tag", tag, "--file", containerfile, dirname(containerfile)];
}

export function imageSizeArgs(tag: string): string[] {
  return ["image", "inspect", "--format", "{{.Size}}", tag];
}

/** A container whose process 1 is systemd; Podman mounts /run, /tmp and the cgroups for it. */
export function systemdContainerArgs(name: string, image: string): string[] {
  return ["run", "-d", "--name", name, "--systemd=always", image];
}

export function execArgs(name: string, command: string[], options: ExecOptions = {}): string[] {
  const { user, workdir, env = {} } = options;
  return [
    "exec",
    ...(user === undefined ? [] : ["--user", user]),
    ...(workdir === undefined ? [] : ["--workdir", workdir]),
    ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    name,
    ...command,
  ];
}

export function copyInArgs(name: string, localPath: string, containerDirectory: string): string[] {
  return ["cp", localPath, `${name}:${containerDirectory}`];
}

export function copyOutArgs(name: string, containerPath: string, localDirectory: string): string[] {
  return ["cp", `${name}:${containerPath}`, localDirectory];
}

export function forceRemoveArgs(name: string): string[] {
  return ["rm", "--force", "--time", String(DEBIAN_STOP_SECONDS), name];
}
