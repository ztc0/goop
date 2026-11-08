import {
  forceRemoveArgs,
  installContainerArgs,
  manualRemoveCommand,
  overlayArgs,
  runContainerArgs,
  stopArgs,
  systemdContainerArgs,
} from "@scripts/sandbox/model/podman-args";
import type { ContainerEngine, SandboxPaths } from "@scripts/sandbox/types/sandbox";
import {
  buildArgs,
  copyInArgs,
  copyOutArgs,
  execArgs,
  imageSizeArgs,
  listRunningArgs,
  logsArgs,
  type ProcessRunner,
  podmanEnvironment,
  podmanGlobalArgs,
  removeArgs,
} from "@scripts/shared/containers";

/** Podman against the repo-local storage: every call carries the global flags (S3). */
export function createPodmanEngine(runner: ProcessRunner, paths: SandboxPaths): ContainerEngine {
  const podman = (args: string[], password?: string, stream?: boolean, interactive?: boolean) =>
    runner.run({
      command: ["podman", ...podmanGlobalArgs(paths), ...args],
      env: podmanEnvironment(paths, password),
      ...(stream ? { stream } : {}),
      ...(interactive ? { interactive } : {}),
    });
  return {
    name: "podman",
    startInstall: (password) => podman(installContainerArgs(paths), password),
    createOverlay: (runId) => podman(overlayArgs(paths, runId)),
    startRun: (runId, password) => podman(runContainerArgs(paths, runId), password),
    stop: (name) => podman(stopArgs(name)),
    remove: (name) => podman(removeArgs(name)),
    logs: (name) => podman(logsArgs(name)),
    listRunning: (prefix) => podman(listRunningArgs(prefix)),
    buildImage: (tag, containerfile) => podman(buildArgs(tag, containerfile), undefined, true),
    imageSize: (tag) => podman(imageSizeArgs(tag)),
    startSystemd: (name, image) => podman(systemdContainerArgs(name, image)),
    exec: (name, command, options) =>
      podman(execArgs(name, command, options), undefined, options?.stream, options?.interactive),
    copyIn: (name, localPath, directory) => podman(copyInArgs(name, localPath, directory)),
    copyOut: (name, containerPath, directory) =>
      podman(copyOutArgs(name, containerPath, directory)),
    forceRemove: (name) => podman(forceRemoveArgs(name)),
    manualRemoveCommand: (name) => manualRemoveCommand(paths, name),
  };
}
