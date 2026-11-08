import { dirname, join, relative } from "node:path";
import { buildArgs } from "../../shared/containers";
import { sha256Hex, sha256Mismatch } from "../../shared/download";
import { checkToolchain } from "../model/checks";
import { runArgs } from "../model/engine";
import { manifestText, parseManifest, withEntry } from "../model/manifest";
import type { BuildDeps, BuildOptions, LibraryRecipe, NativeManifest } from "../types/native-libs";
import { verifySignature } from "./signature";

const decode = (content: Uint8Array | undefined) =>
  content === undefined ? undefined : new TextDecoder().decode(content);

/**
 * Builds one library for one platform (S1, S2): the signature when asked, the archive's sha256
 * before anything reads it, a fresh `--rm` container without network, the toolchain and source
 * version, then the output's sha256 against its pin. Only then are the library and the manifest
 * written; any failure writes nothing to `.local/build/native/`.
 */
export async function buildLibrary(
  deps: BuildDeps,
  recipe: LibraryRecipe,
  options: BuildOptions,
): Promise<number> {
  const startedAt = deps.now();
  const error = await build(deps, recipe, options);
  if (error === undefined) {
    const { root, output, manifest } = deps.paths;
    const library = relative(root, join(output, recipe.platform, recipe.output.file));
    const elapsed = ((deps.now() - startedAt) / 1000).toFixed(1);
    deps.output.info(`Wrote ${library} and ${relative(root, manifest)} in ${elapsed} s.`);
    return 0;
  }
  deps.output.error(error);
  deps.output.error(`Nothing was written to ${relative(deps.paths.root, deps.paths.output)}/.`);
  return 1;
}

/** Every step up to the writes; undefined when they are done, else the error. */
async function build(
  deps: BuildDeps,
  recipe: LibraryRecipe,
  options: BuildOptions,
): Promise<string | undefined> {
  const { paths, engine, files, output } = deps;
  const { archive, source } = recipe;
  const containers = (args: string[]) =>
    deps.runner.run({ command: [...engine.command, ...args], env: engine.env, stream: true });
  for (const directory of engine.directories) files.makeDirectory(directory);

  output.info(`${recipe.name} ${recipe.platform}`);
  if (options.verifySignature) {
    const failed = await verifySignature(deps, recipe, options.cosign);
    if (failed !== undefined) return failed;
  } else {
    output.info(
      "Signature: not checked (pass --verify-signature; it needs Rekor, the Sigstore transparency log).",
    );
  }

  output.info(`Downloading ${archive.name}...`);
  let bytes: Uint8Array;
  try {
    bytes = await deps.download(archive.url, archive.maxBytes);
  } catch (error) {
    return `Could not download ${archive.name}: ${(error as Error).message}`;
  }
  const mismatch = sha256Mismatch(archive.name, archive.sha256, bytes);
  if (mismatch !== undefined) return mismatch;
  const download = files.freshDirectory(paths.downloads, `${recipe.name}-`);
  files.writeNew(join(download, archive.name), bytes);
  output.info(`sha256 ok: ${archive.name}`);

  output.info(`Building the image ${recipe.image} with ${engine.name}...`);
  const built = await containers(buildArgs(recipe.image, join(paths.root, recipe.containerfile)));
  if (built.exitCode !== 0) {
    return `Could not build the image (${engine.name} build exited ${built.exitCode}).`;
  }
  const extract = files.freshDirectory(paths.extract, `${recipe.name}-`);
  const out = files.freshDirectory(paths.staging, `${recipe.name}-`);
  output.info(`Compiling in a fresh ${engine.name} container, without network...`);
  const ran = await containers(runArgs(engine, recipe, { download, extract, out }));
  if (ran.exitCode !== 0) {
    return `The build container failed (${engine.name} run exited ${ran.exitCode}).`;
  }

  const problems = checkToolchain(
    recipe.toolchain,
    decode(files.read(join(out, "toolchain.txt"))) ?? "",
  );
  if (problems.length > 0) return `The build image has another toolchain: ${problems.join("; ")}`;
  output.info(
    `Toolchain ok: ${recipe.toolchain.map((entry) => `${entry.name} ${entry.version}`).join(", ")}`,
  );
  const version = source.version(decode(files.read(join(extract, source.file))) ?? "");
  if (version !== source.expected) {
    return `${source.file} declares ${source.label} ${version ?? "no version"}, expected ${source.expected}.`;
  }
  output.info(`Source ok: ${source.label} ${version}`);

  const library = files.read(join(out, recipe.output.file)) ?? new Uint8Array();
  const sha256 = sha256Hex(library);
  if (sha256 !== recipe.output.sha256) {
    return `The built ${recipe.output.file} does not match its pin: expected ${recipe.output.sha256}, got ${sha256}.`;
  }
  output.info(`Output sha256 ok: ${sha256}  ${recipe.output.file}`);

  const existing = decode(files.read(paths.manifest));
  let previous: NativeManifest | undefined;
  if (existing !== undefined) {
    const parsed = parseManifest(existing);
    if ("error" in parsed) {
      return `The existing ${relative(paths.root, paths.manifest)} cannot be read (${parsed.error}); fix or remove it.`;
    }
    previous = parsed.manifest;
  }
  const text = manifestText(withEntry(previous, recipe.name, recipe.platform, recipe.output));
  const checked = parseManifest(text);
  if ("error" in checked) return checked.error;
  const target = join(paths.output, recipe.platform, recipe.output.file);
  files.makeDirectory(dirname(target));
  files.replace(target, library);
  files.replace(paths.manifest, new TextEncoder().encode(text));
  return undefined;
}
