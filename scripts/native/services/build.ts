import { dirname, join, relative } from "node:path";
import { buildArgs } from "../../sandbox/model/podman-args";
import { formatElapsed } from "../../sandbox/model/readiness";
import { sha256Hex } from "../../shared/download";
import { checkArchive, checkToolchain, MAX_ARCHIVE_BYTES, sqliteVersionOf } from "../model/checks";
import { BUILD_IMAGE, nativeRunArgs } from "../model/compile";
import { TOOLCHAIN } from "../model/inputs";
import { buildManifest, LINUX_LIBRARY, manifestText, parseManifest } from "../model/manifest";
import type { NativeBuildDeps, PinnedArchive } from "../types/native-build";

/**
 * Builds `libsqlite3mc.so` for linux-x64 (S8): the pinned image, a fresh download checked against
 * its sha256 before anything reads it, a fresh `--rm` container without network, then the
 * toolchain and SQLite version checks. Only then are the library and its manifest written.
 */
export async function buildNative(deps: NativeBuildDeps, archive: PinnedArchive): Promise<number> {
  const { paths, engine, runner, files, output } = deps;
  const startedAt = deps.now();
  const containers = (args: string[]) =>
    runner.run({ command: [...engine.command, ...args], env: engine.env, stream: true });
  if (engine.name === "podman") {
    for (const directory of paths.containerDirectories) files.makeDirectory(directory);
  }

  output.info(`Building the image ${BUILD_IMAGE} with ${engine.name}...`);
  const built = await containers(buildArgs(BUILD_IMAGE, paths.containerfile));
  if (built.exitCode !== 0) {
    output.error(`Could not build the image (${engine.name} build exited ${built.exitCode}).`);
    return 1;
  }

  output.info(`Downloading ${archive.name}...`);
  const download = files.freshDirectory(paths.downloads, "sqlite3mc-");
  let bytes: Uint8Array;
  try {
    bytes = await deps.download(archive.url, MAX_ARCHIVE_BYTES);
  } catch (error) {
    output.error(`Could not download ${archive.name}: ${(error as Error).message}`);
    return 1;
  }
  const mismatch = checkArchive(archive, bytes);
  if (mismatch !== undefined) {
    output.error(mismatch);
    return 1;
  }
  files.writeFile(join(download, archive.name), bytes);
  output.info(`sha256 ok: ${archive.name}`);

  const extract = files.freshDirectory(paths.extract, "sqlite3mc-");
  const out = files.freshDirectory(paths.staging, "native-build-");
  output.info(
    `Compiling ${archive.member} in a fresh ${engine.name} container, without network...`,
  );
  const ran = await containers(nativeRunArgs(engine, { download, extract, out }));
  if (ran.exitCode !== 0) {
    output.error(`The build container failed (${engine.name} run exited ${ran.exitCode}).`);
    return 1;
  }

  const version = sqliteVersionOf(files.readText(join(extract, archive.member)));
  if (version !== archive.sqliteVersion) {
    output.error(
      `${archive.member} declares SQLite ${version ?? "no version"}, expected ${archive.sqliteVersion}.`,
    );
    return 1;
  }
  const problems = checkToolchain(files.readText(join(out, "toolchain.txt")));
  if (problems.length > 0) {
    output.error(`The build image has another toolchain: ${problems.join("; ")}`);
    return 1;
  }
  output.info(
    `Toolchain: ${TOOLCHAIN.map((entry) => `${entry.name} ${entry.version}`).join(", ")}`,
  );

  const library = files.readBytes(join(out, LINUX_LIBRARY));
  const sha256 = sha256Hex(library);
  const text = manifestText(buildManifest(sha256));
  const parsed = parseManifest(text);
  if ("error" in parsed) {
    output.error(parsed.error);
    return 1;
  }
  files.makeDirectory(dirname(paths.library));
  files.replaceFile(paths.library, library);
  files.replaceFile(paths.manifest, text);
  output.info(`${sha256}  ${relative(paths.root, paths.library)}`);
  output.info(
    `Wrote ${relative(paths.root, paths.manifest)} in ${formatElapsed(deps.now() - startedAt)}.`,
  );
  return 0;
}
