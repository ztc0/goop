import { join, relative } from "node:path";
import { baseFilesToCopy, resolveCopyPath } from "../model/base-files";
import { displayPath, resultsDirectory, runDirectory } from "../model/paths";
import { RUN_READINESS } from "../model/readiness";
import { runContainerName, SSH_PORT, WEB_URL } from "../model/vm-config";
import type { RunRequest, SandboxDeps } from "../types/sandbox";
import {
  guestPassword,
  INTERRUPTED_EXIT_CODE,
  prepareContainerStorage,
  reportNotReady,
  waitUntilReady,
} from "./vm-lifecycle";

/**
 * Runs one PowerShell command in a throwaway VM (S5): a `--rm` container boots a qcow2
 * overlay over the read-only base, and the container and the overlay are deleted when the
 * run ends, even on failure or Ctrl+C. Returns the guest command's exit code.
 */
export async function runInWindows(
  deps: SandboxDeps,
  request: RunRequest,
  runId: string,
): Promise<number> {
  const { paths, files, output, engine, guest } = deps;
  if (!files.exists(paths.baseDisk)) {
    output.error("No Windows base: run `bun run sandbox:install windows` first.");
    return 1;
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

  files.makeDirectory(paths.temp);
  prepareContainerStorage(deps);
  const runDir = runDirectory(paths, runId);
  files.makeDirectory(runDir);
  const container = runContainerName(runId);
  let started = false;
  try {
    output.info("Creating a throwaway disk over the Windows base...");
    const overlay = await engine.createOverlay(runId);
    if (overlay.exitCode !== 0) {
      output.error(`Could not create the throwaway disk: ${overlay.stderr.trim()}`);
      return 1;
    }
    for (const name of baseFilesToCopy(files.listFiles(paths.base).map((file) => file.name))) {
      files.copyFile(join(paths.base, name), join(runDir, name));
    }

    output.info(`Starting ${container}...`);
    const vm = await engine.startRun(runId, guestPassword(deps, false));
    if (vm.exitCode !== 0) {
      output.error(`Could not start ${container}: ${vm.stderr.trim()}`);
      return 1;
    }
    started = true;
    output.info(`Waiting for SSH on 127.0.0.1:${SSH_PORT} (watch at ${WEB_URL})...`);
    const readiness = await waitUntilReady(
      deps,
      RUN_READINESS,
      () => guest.isReachable(),
      () => {},
    );
    if (readiness !== "ready") {
      return await reportNotReady(deps, readiness, RUN_READINESS, container);
    }
    output.info("Windows is ready.");

    if (uploads.length > 0) {
      const prepared = await guest.prepareUploads();
      if (prepared.exitCode !== 0) {
        output.error(`Could not create C:\\goop\\: ${prepared.stderr.trim()}`);
        return 1;
      }
    }
    for (const absolute of uploads) {
      output.info(`Uploading ${relative(paths.root, absolute)} to C:\\goop\\...`);
      const uploaded = await guest.upload(absolute);
      if (uploaded.exitCode !== 0) {
        output.error(
          `Could not upload ${relative(paths.root, absolute)}: ${uploaded.stderr.trim()}`,
        );
        return 1;
      }
    }

    let exitCode = await guest.execute(request.command);
    if (deps.signal.aborted) {
      output.error("Interrupted.");
      return INTERRUPTED_EXIT_CODE;
    }

    const results = resultsDirectory(paths, runId);
    if (request.fetch.length > 0) files.makeDirectory(results);
    for (const guestPath of request.fetch) {
      const fetched = await guest.download(guestPath, results);
      if (fetched.exitCode === 0) {
        output.info(`Fetched ${guestPath} into ${displayPath(paths, results)}`);
      } else {
        output.error(`Could not fetch ${guestPath}: ${fetched.stderr.trim()}`);
        if (exitCode === 0) exitCode = 1;
      }
    }
    return exitCode;
  } finally {
    if (started) {
      output.info(`Stopping ${container}...`);
      await engine.stop(container);
    }
    files.removeDirectory(runDir);
  }
}
