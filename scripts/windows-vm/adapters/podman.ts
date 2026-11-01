import {
  installContainerArgs,
  listRunningArgs,
  logsArgs,
  overlayArgs,
  podmanEnvironment,
  podmanGlobalArgs,
  removeArgs,
  runContainerArgs,
  stopArgs,
} from "../model/podman-args";
import type { Podman, ProcessRunner, WindowsVmPaths } from "../types/windows-vm";

/** Podman against the repo-local storage: every call carries the global flags (S3). */
export function createPodman(runner: ProcessRunner, paths: WindowsVmPaths): Podman {
  const podman = (args: string[], password?: string) =>
    runner.run({
      command: ["podman", ...podmanGlobalArgs(paths), ...args],
      env: podmanEnvironment(paths, password),
    });
  return {
    startInstall: (password) => podman(installContainerArgs(paths), password),
    createOverlay: (runId) => podman(overlayArgs(paths, runId)),
    startRun: (runId, password) => podman(runContainerArgs(paths, runId), password),
    stop: (name) => podman(stopArgs(name)),
    remove: (name) => podman(removeArgs(name)),
    logs: (name) => podman(logsArgs(name)),
    listRunning: () => podman(listRunningArgs()),
  };
}
