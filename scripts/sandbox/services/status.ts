import { formatBytes } from "@scripts/sandbox/model/base-files";
import { displayPath } from "@scripts/sandbox/model/paths";
import { CONTAINER_PREFIX } from "@scripts/sandbox/model/vm-config";
import { prepareContainerStorage } from "@scripts/sandbox/services/vm-lifecycle";
import type { SandboxDeps } from "@scripts/sandbox/types/sandbox";

/** Prints whether the Windows base exists, its size, and the running goop-windows containers. */
export async function showStatus(deps: SandboxDeps): Promise<number> {
  const { paths, files, output } = deps;
  if (files.exists(paths.baseDisk)) {
    const size = files.listFiles(paths.base).reduce((total, file) => total + file.size, 0);
    output.info(`Windows base: ${displayPath(paths, paths.base)} (${formatBytes(size)})`);
  } else {
    output.info("Windows base: none (run `bun run sandbox install windows`)");
  }

  prepareContainerStorage(deps);
  return await listContainers(deps, CONTAINER_PREFIX, "Running VMs");
}

/** Prints the running containers whose name starts with the prefix, under the label. */
export async function listContainers(
  deps: SandboxDeps,
  prefix: string,
  label: string,
): Promise<number> {
  const { output, engine } = deps;
  const running = await engine.listRunning(prefix);
  if (running.exitCode !== 0) {
    output.error(`Could not list the containers: ${running.stderr.trim()}`);
    return 1;
  }
  const containers = running.stdout.split("\n").filter((line) => line.trim() !== "");
  if (containers.length === 0) {
    output.info(`${label}: none`);
    return 0;
  }
  output.info(`${label}:`);
  for (const line of containers) output.info(`  ${line}`);
  return 0;
}
