import {
  buildArgs,
  copyInArgs,
  copyOutArgs,
  dockerEnvironment,
  execArgs,
  imageSizeArgs,
  listRunningArgs,
  logsArgs,
  type ProcessRunner,
  removeArgs,
} from "../../shared/containers";
import {
  forceRemoveArgs,
  installContainerArgs,
  manualRemoveCommand,
  overlayArgs,
  runContainerArgs,
  stopArgs,
  systemdContainerArgs,
} from "../model/docker-args";
import type { ContainerEngine, SandboxPaths } from "../types/sandbox";

/** Docker through its daemon, which keeps images and containers in its own storage (S3, S4). */
export function createDockerEngine(runner: ProcessRunner, paths: SandboxPaths): ContainerEngine {
  const docker = (args: string[], password?: string, stream?: boolean, interactive?: boolean) =>
    runner.run({
      command: ["docker", ...args],
      env: dockerEnvironment(password),
      ...(stream ? { stream } : {}),
      ...(interactive ? { interactive } : {}),
    });
  return {
    name: "docker",
    startInstall: (password) => docker(installContainerArgs(paths), password),
    createOverlay: (runId) => docker(overlayArgs(paths, runId)),
    startRun: (runId, password) => docker(runContainerArgs(paths, runId), password),
    stop: (name) => docker(stopArgs(name)),
    remove: (name) => docker(removeArgs(name)),
    logs: (name) => docker(logsArgs(name)),
    listRunning: (prefix) => docker(listRunningArgs(prefix)),
    buildImage: (tag, containerfile) => docker(buildArgs(tag, containerfile), undefined, true),
    imageSize: (tag) => docker(imageSizeArgs(tag)),
    startSystemd: (name, image) => docker(systemdContainerArgs(name, image)),
    exec: (name, command, options) =>
      docker(execArgs(name, command, options), undefined, options?.stream, options?.interactive),
    copyIn: (name, localPath, directory) => docker(copyInArgs(name, localPath, directory)),
    copyOut: (name, containerPath, directory) =>
      docker(copyOutArgs(name, containerPath, directory)),
    forceRemove: (name) => docker(forceRemoveArgs(name)),
    manualRemoveCommand,
  };
}
