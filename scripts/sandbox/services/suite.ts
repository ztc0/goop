import { dirname, join, relative } from "node:path";
import { sha256Hex, sha256Mismatch } from "../../shared/download";
import {
  bunCachePath,
  checkBunZip,
  checkPackageManager,
  MAX_BUN_ZIP_BYTES,
  MAX_SHASUMS_BYTES,
  shasumsUrl,
} from "../model/bun-release";
import { DEBIAN_IMAGE } from "../model/debian-config";
import { displayPath } from "../model/paths";
import {
  GIT_ROOT_MARKER,
  repoFiles,
  repoFilesArgs,
  SUITE_BUN,
  SUITE_PLANS,
  SUITE_REPO,
  suiteCommand,
  suiteSummary,
} from "../model/suite";
import { zipMember } from "../model/zip";
import type {
  PinnedBun,
  RunRequest,
  SandboxDeps,
  SandboxOs,
  SuiteDeps,
  SuitePlan,
} from "../types/sandbox";
import { runInDebian } from "./debian";
import { runInWindows } from "./run";
import { prepareContainerStorage } from "./vm-lifecycle";

/** What the suite needs from each system: the check before downloading, and the run itself. */
interface SuiteSystem {
  ready(deps: SandboxDeps): Promise<boolean>;
  run(deps: SandboxDeps, request: RunRequest, runId: string): Promise<number>;
}

const SYSTEMS: Record<SandboxOs, SuiteSystem> = {
  windows: { ready: windowsReady, run: runInWindows },
  debian: { ready: debianReady, run: runInDebian },
};

/**
 * Runs the whole test suite in a throwaway sandbox (T8): the pinned Bun, checked against its
 * sha256 and cached under .local/, and a copy of the repo are uploaded, then the suite runs there.
 * The copy is deleted when the run ends. Returns the suite's exit code.
 */
export async function runSuite(
  deps: SuiteDeps,
  os: SandboxOs,
  runId: string,
  plans: Record<SandboxOs, SuitePlan> = SUITE_PLANS,
): Promise<number> {
  const { paths, files, output, clock } = deps;
  const plan = plans[os];
  const release = plan.bun;
  const system = SYSTEMS[os];
  if (!(await system.ready(deps))) return 1;
  const packageJson = join(paths.root, "package.json");
  const pinError = checkPackageManager(
    files.exists(packageJson) ? files.readText(packageJson) : "",
    release.version,
  );
  if (pinError !== undefined) {
    output.error(pinError);
    return 1;
  }
  const startedAt = clock.now();
  const bun = await verifiedBun(deps, release);
  if (bun === undefined) return 1;
  const listed = await deps.runner.run({ command: repoFilesArgs(paths.root) });
  if (listed.exitCode !== 0) {
    output.error(`Could not list the repo files: ${listed.stderr.trim()}`);
    return 1;
  }

  const staging = join(paths.suite, runId);
  try {
    // A tracked file deleted in the working tree is still listed; the copy skips it.
    const names = repoFiles(listed.stdout).filter((name) => files.exists(join(paths.root, name)));
    output.info(
      `Copying ${names.length} repo files and Bun ${release.version} into ${displayPath(paths, staging)}...`,
    );
    for (const name of names) {
      const to = join(staging, SUITE_REPO, name);
      files.makeDirectory(dirname(to));
      files.copyFile(join(paths.root, name), to);
    }
    files.makeDirectory(join(staging, SUITE_REPO, GIT_ROOT_MARKER));
    files.makeDirectory(join(staging, SUITE_BUN));
    files.copyFile(bun, join(staging, SUITE_BUN, release.binary));

    const request: RunRequest = {
      copy: [join(staging, SUITE_REPO), join(staging, SUITE_BUN)],
      fetch: [],
      command: suiteCommand(plan),
    };
    const exitCode = await system.run(deps, request, runId);
    const summary = suiteSummary(os, exitCode, clock.now() - startedAt);
    if (exitCode === 0) output.info(summary);
    else output.error(summary);
    return exitCode;
  } finally {
    files.removeDirectory(staging);
  }
}

async function windowsReady(deps: SandboxDeps): Promise<boolean> {
  if (deps.files.exists(deps.paths.baseDisk)) return true;
  deps.output.error("No Windows base: run `bun run sandbox:install windows` first.");
  return false;
}

async function debianReady(deps: SandboxDeps): Promise<boolean> {
  const { output, engine } = deps;
  prepareContainerStorage(deps);
  if ((await engine.imageSize(DEBIAN_IMAGE)).exitCode === 0) return true;
  output.error("No Debian image: run `bun run sandbox:install debian` first.");
  return false;
}

/**
 * The cached Bun when its sha256 still matches the pin; else downloads the release zip into a
 * fresh folder, checks it against SHASUMS256.txt and the pins, and caches the executable. Nothing
 * from the download runs on the host. Undefined after reporting a failure.
 */
async function verifiedBun(deps: SuiteDeps, release: PinnedBun): Promise<string | undefined> {
  const { paths, files, output } = deps;
  const cached = bunCachePath(paths, release);
  const shown = relative(paths.root, cached).replaceAll("\\", "/");
  if (files.exists(cached) && sha256Hex(files.readBytes(cached)) === release.binarySha256) {
    output.info(`Using Bun ${release.version} from ${shown} (sha256 ok).`);
    return cached;
  }

  output.info(`Downloading Bun ${release.version} (${release.asset}) from GitHub...`);
  const folder = files.freshDirectory(paths.downloads, "bun-");
  const shasums = await download(deps, shasumsUrl(release.version), MAX_SHASUMS_BYTES);
  if (shasums === undefined) return undefined;
  const zip = await download(deps, release.url, MAX_BUN_ZIP_BYTES);
  if (zip === undefined) return undefined;
  const problem = checkBunZip(release, zip, new TextDecoder().decode(shasums));
  if (problem !== undefined) {
    output.error(problem);
    return undefined;
  }
  files.writeBytes(join(folder, release.asset), zip);

  const binary = zipMember(zip, release.member);
  if (!(binary instanceof Uint8Array)) {
    output.error(`Could not read ${release.member} from ${release.asset}: ${binary.error}`);
    return undefined;
  }
  const mismatch = sha256Mismatch(release.member, release.binarySha256, binary);
  if (mismatch !== undefined) {
    output.error(mismatch);
    return undefined;
  }
  files.makeDirectory(dirname(cached));
  files.writeBytes(cached, binary, 0o755);
  output.info(`sha256 ok: ${release.asset} and ${release.member}, kept in ${shown}`);
  return cached;
}

async function download(
  deps: SuiteDeps,
  url: string,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  try {
    return await deps.download(url, maxBytes);
  } catch (error) {
    deps.output.error(`Could not download ${url}: ${(error as Error).message}`);
    return undefined;
  }
}
