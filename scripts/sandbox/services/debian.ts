import { relative } from "node:path";
import { formatBytes, resolveCopyPath } from "@scripts/sandbox/model/base-files";
import {
  DEBIAN_IMAGE,
  DEBIAN_PREFIX,
  DEBIAN_READINESS,
  DEBIAN_USER,
  DEBIAN_WORKDIR,
  debianContainerName,
  debianResultsDirectory,
  isSystemdUp,
  SYSTEMD_READY_CHECK,
  userCommand,
  userShell,
} from "@scripts/sandbox/model/debian-config";
import { displayPath } from "@scripts/sandbox/model/paths";
import { formatElapsed } from "@scripts/sandbox/model/readiness";
import { listContainers } from "@scripts/sandbox/services/status";
import {
  INTERRUPTED_EXIT_CODE,
  prepareContainerStorage,
  reportNotReady,
  waitUntilReady,
} from "@scripts/sandbox/services/vm-lifecycle";
import type { RunRequest, SandboxDeps } from "@scripts/sandbox/types/sandbox";

/** Builds the Debian image into the engine's storage (S2); the layer cache makes a rebuild quick. */
export async function installDebian(deps: SandboxDeps): Promise<number> {
  const { paths, output, engine, clock } = deps;
  prepareContainerStorage(deps);
  output.info(
    `Building ${DEBIAN_IMAGE} from ${relative(paths.root, paths.debianContainerfile)}...`,
  );
  const startedAt = clock.now();
  const built = await engine.buildImage(DEBIAN_IMAGE, paths.debianContainerfile);
  if (built.exitCode !== 0) {
    output.error(
      `Could not build the Debian image (${engine.name} build exited ${built.exitCode}).`,
    );
    return 1;
  }
  output.info(`Debian image ${DEBIAN_IMAGE} is ready (${formatElapsed(clock.now() - startedAt)}).`);
  return 0;
}

/**
 * Runs one shell command, or an interactive shell when the command is empty, in a new Debian
 * container with systemd as process 1 (S2), as the user goop. The container is removed when
 * the run ends, even on failure or Ctrl+C. Returns the command's exit code.
 */
export async function runInDebian(
  deps: SandboxDeps,
  request: RunRequest,
  runId: string,
): Promise<number> {
  const { paths, files, output, engine } = deps;
  if (request.command === "" && !deps.terminal) {
    output.error(
      "run debian without a command opens a shell and needs a terminal; pass a command instead, like: bun run sandbox:run debian uname -a",
    );
    return 2;
  }
  const uploads: string[] = [];
  for (const path of request.copy) {
    const absolute = resolveCopyPath(paths.root, path);
    if (absolute === undefined || !files.exists(absolute)) {
      output.error(`Cannot copy ${path}: only existing paths inside the repo can be uploaded.`);
      return 1;
    }
    uploads.push(absolute);
  }
  prepareContainerStorage(deps);
  if ((await engine.imageSize(DEBIAN_IMAGE)).exitCode !== 0) {
    output.error("No Debian image: run `bun run sandbox:install debian` first.");
    return 1;
  }

  const container = debianContainerName(runId);
  let exitCode = 1;
  try {
    exitCode = await runInContainer(deps, request, runId, container, uploads);
  } finally {
    output.info(`Removing ${container}...`);
    const removed = await engine.forceRemove(container);
    if (removed.exitCode !== 0) {
      output.error(
        `Could not remove ${container}: ${removed.stderr.trim()}. Remove it by hand: ${engine.manualRemoveCommand(container)}`,
      );
      if (exitCode === 0) exitCode = 1;
    }
  }
  return exitCode;
}

/** Starts the container, waits for systemd, copies, runs and fetches; the caller removes it. */
async function runInContainer(
  deps: SandboxDeps,
  request: RunRequest,
  runId: string,
  container: string,
  uploads: string[],
): Promise<number> {
  const { paths, files, output, engine } = deps;
  output.info(`Starting ${container}...`);
  const started = await engine.startSystemd(container, DEBIAN_IMAGE);
  if (started.exitCode !== 0) {
    output.error(`Could not start ${container}: ${started.stderr.trim()}`);
    return 1;
  }
  output.info("Waiting for systemd...");
  let state = "";
  const readiness = await waitUntilReady(
    deps,
    DEBIAN_READINESS,
    async () => {
      state = (await engine.exec(container, SYSTEMD_READY_CHECK)).stdout.trim();
      return isSystemdUp(state);
    },
    () => {},
  );
  if (readiness !== "ready") {
    return await reportNotReady(deps, readiness, DEBIAN_READINESS, container, "Debian");
  }
  output.info(`systemd is ${state}.`);

  for (const absolute of uploads) {
    output.info(`Copying ${relative(paths.root, absolute)} to ${DEBIAN_WORKDIR}/...`);
    const copied = await engine.copyIn(container, absolute, `${DEBIAN_WORKDIR}/`);
    if (copied.exitCode !== 0) {
      output.error(`Could not copy ${relative(paths.root, absolute)}: ${copied.stderr.trim()}`);
      return 1;
    }
  }
  if (uploads.length > 0) {
    const owner = `${DEBIAN_USER}:${DEBIAN_USER}`;
    await engine.exec(container, ["chown", "-R", owner, DEBIAN_WORKDIR]);
  }

  if (request.command === "") {
    output.info(
      `Opening a shell as ${DEBIAN_USER} in ${DEBIAN_WORKDIR}; type exit to leave and delete the container.`,
    );
  }
  const user = request.command === "" ? userShell() : userCommand(request.command);
  let { exitCode } = await engine.exec(container, user.command, user.options);
  if (deps.signal.aborted) {
    output.error("Interrupted.");
    return INTERRUPTED_EXIT_CODE;
  }

  const results = debianResultsDirectory(paths, runId);
  if (request.fetch.length > 0) files.makeDirectory(results);
  for (const path of request.fetch) {
    const fetched = await engine.copyOut(container, path, `${results}/`);
    if (fetched.exitCode === 0) {
      output.info(`Fetched ${path} into ${displayPath(paths, results)}`);
    } else {
      output.error(`Could not fetch ${path}: ${fetched.stderr.trim()}`);
      if (exitCode === 0) exitCode = 1;
    }
  }
  return exitCode;
}

/** Prints whether the Debian image is built, its size, and the running goop-debian containers. */
export async function showDebianStatus(deps: SandboxDeps): Promise<number> {
  const { output, engine } = deps;
  prepareContainerStorage(deps);
  const size = await engine.imageSize(DEBIAN_IMAGE);
  if (size.exitCode === 0) {
    output.info(`Debian image: ${DEBIAN_IMAGE} (${formatBytes(Number(size.stdout.trim()))})`);
  } else {
    output.info("Debian image: none (run `bun run sandbox:install debian`)");
  }
  return await listContainers(deps, DEBIAN_PREFIX, "Running containers");
}
