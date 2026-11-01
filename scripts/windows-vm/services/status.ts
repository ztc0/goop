import { formatBytes } from "../model/base-files";
import { displayPath } from "../model/paths";
import type { WindowsVmDeps } from "../types/windows-vm";
import { prepareContainerStorage } from "./vm-lifecycle";

/** Prints whether the Windows base exists, its size, and the running goop-windows containers. */
export async function showStatus(deps: WindowsVmDeps): Promise<number> {
  const { paths, files, output, podman } = deps;
  if (files.exists(paths.baseDisk)) {
    const size = files.listFiles(paths.base).reduce((total, file) => total + file.size, 0);
    output.info(`Windows base: ${displayPath(paths, paths.base)} (${formatBytes(size)})`);
  } else {
    output.info("Windows base: none (run `bun run windows:install`)");
  }

  prepareContainerStorage(deps);
  const running = await podman.listRunning();
  if (running.exitCode !== 0) {
    output.error(`Could not list the containers: ${running.stderr.trim()}`);
    return 1;
  }
  const containers = running.stdout.split("\n").filter((line) => line.trim() !== "");
  if (containers.length === 0) {
    output.info("Running VMs: none");
    return 0;
  }
  output.info("Running VMs:");
  for (const line of containers) output.info(`  ${line}`);
  return 0;
}
