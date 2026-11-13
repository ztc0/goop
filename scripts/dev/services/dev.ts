// `bun run dev`, `dev:logs` and `dev:stop` (S7): the dev container runs the goop daemon, goop
// runs next to it with the arguments it was given.
import { relative } from "node:path";
import {
  CONTAINER,
  followLogsArgs,
  forceRemoveArgs,
  goopArgs,
  hostFolders,
  IMAGE,
  isRunning,
  runningArgs,
  socketCheckArgs,
  startArgs,
} from "@scripts/dev/model/container-args";
import type { DevDeps } from "@scripts/dev/types/dev";
import { buildArgs, imageSizeArgs } from "@scripts/shared/containers";

/** The first start installs the packages before the daemon listens, so the wait is generous. */
export const READY_TIMEOUT_MS = 300_000;
const POLL_MS = 1_000;
const LOGS_HINT = "See its output with: bun run dev:logs";

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

/** Starts the container when it is not running, waits for the daemon, then runs goop in it. */
export async function runGoop(deps: DevDeps, args: readonly string[]): Promise<number> {
  const { engine, output, paths } = deps;
  const inspected = await engine.call(runningArgs());
  if (!isRunning(inspected)) {
    // Inspect succeeds on a stopped container: remove it so the name is free.
    if (inspected.exitCode === 0) await engine.call(forceRemoveArgs());
    if ((await engine.call(imageSizeArgs(IMAGE))).exitCode !== 0) {
      const recipe = relative(paths.root, paths.containerfile).replaceAll("\\", "/");
      output.info(`Building the dev image ${IMAGE} from ${recipe} (once, a few minutes)...`);
      if ((await engine.call(buildArgs(IMAGE, paths.containerfile), "stream")).exitCode !== 0) {
        output.error(`Building ${IMAGE} failed; see the output above.`);
        return 1;
      }
    }
    deps.folders.ensure(hostFolders(paths));
    output.info(
      `Starting the dev container ${CONTAINER}: the goop daemon, restarted on every source change.`,
    );
    const started = await engine.call(startArgs(paths, engine.user));
    if (started.exitCode !== 0) {
      output.error(`Cannot start ${CONTAINER}: ${firstLine(started.stderr)}`);
      output.error(LOGS_HINT);
      return 1;
    }
  }
  if (!(await waitForDaemon(deps))) return 1;
  const result = await engine.call(
    goopArgs(paths, args, deps.terminal),
    deps.terminal ? "interactive" : "stream",
  );
  return result.exitCode;
}

/** Polls for the daemon's socket every second, for at most READY_TIMEOUT_MS. */
async function waitForDaemon(deps: DevDeps): Promise<boolean> {
  const { engine, output, clock } = deps;
  const deadline = clock.now() + READY_TIMEOUT_MS;
  let announced = false;
  for (;;) {
    if ((await engine.call(socketCheckArgs())).exitCode === 0) return true;
    if (clock.now() >= deadline) {
      output.error(`The goop daemon did not start within ${READY_TIMEOUT_MS / 1000} s.`);
      output.error(LOGS_HINT);
      return false;
    }
    if (!announced) {
      output.info("Waiting for the goop daemon...");
      announced = true;
    }
    if (!isRunning(await engine.call(runningArgs()))) {
      output.error(`${CONTAINER} stopped before the goop daemon was ready.`);
      output.error(LOGS_HINT);
      return false;
    }
    await clock.sleep(POLL_MS);
  }
}

/** Follows the daemon's output until Ctrl+C. */
export async function followLogs(deps: DevDeps): Promise<number> {
  return (await deps.engine.call(followLogsArgs(), "stream")).exitCode;
}

/** Removes the container; goop's data and the packages stay on the host. */
export async function stopDev(deps: DevDeps): Promise<number> {
  const { engine, output } = deps;
  if ((await engine.call(runningArgs())).exitCode !== 0) {
    output.info(`${CONTAINER} is not running.`);
    return 0;
  }
  const removed = await engine.call(forceRemoveArgs());
  if (removed.exitCode !== 0) {
    output.error(`Cannot remove ${CONTAINER}: ${firstLine(removed.stderr)}`);
    return 1;
  }
  output.info(`Removed ${CONTAINER}; .temp/dev/ and .local/dev/ are kept.`);
  return 0;
}
