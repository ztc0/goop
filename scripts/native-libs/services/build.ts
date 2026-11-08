import { dirname, join, relative } from "node:path";
import { checkToolchain } from "@scripts/native-libs/model/checks";
import { runArgs } from "@scripts/native-libs/model/engine";
import { manifestText, parseManifest, withEntry } from "@scripts/native-libs/model/manifest";
import { verifySignature } from "@scripts/native-libs/services/signature";
import type {
  BuildDeps,
  BuildOptions,
  LibraryRecipe,
  NativeManifest,
} from "@scripts/native-libs/types/native-libs";
import { buildArgs } from "@scripts/shared/containers";
import { sha256Hex, sha256Mismatch } from "@scripts/shared/download";

const decode = (content: Uint8Array | undefined) =>
  content === undefined ? undefined : new TextDecoder().decode(content);

/**
 * Builds one library for each of its targets (S1, S2, S3): per target, the signature when asked,
 * the archive's sha256 before anything reads it, a fresh `--rm` container without network, the
 * toolchain and source version, then the output's sha256 against its pin. Only when every target
 * matches are the libraries and the manifest written; any failure writes nothing to
 * `.local/build/native/`, so a published library never sits next to a stale manifest.
 */
export async function buildLibrary(
  deps: BuildDeps,
  recipes: readonly LibraryRecipe[],
  options: BuildOptions,
): Promise<number> {
  const startedAt = deps.now();
  const error = await build(deps, recipes, options);
  if (error === undefined) {
    const { root, output, manifest } = deps.paths;
    const libraries = recipes.map((recipe) =>
      relative(root, join(output, recipe.platform, recipe.output.file)),
    );
    const elapsed = ((deps.now() - startedAt) / 1000).toFixed(1);
    deps.output.info(
      `Wrote ${libraries.join(", ")} and ${relative(root, manifest)} in ${elapsed} s.`,
    );
    return 0;
  }
  deps.output.error(error);
  deps.output.error(`Nothing was written to ${relative(deps.paths.root, deps.paths.output)}/.`);
  return 1;
}

/** Every target, then the writes; undefined when they are done, else the error. */
async function build(
  deps: BuildDeps,
  recipes: readonly LibraryRecipe[],
  options: BuildOptions,
): Promise<string | undefined> {
  const { paths, files } = deps;
  const libraries: Library[] = [];
  for (const recipe of recipes) {
    const library = await buildTarget(deps, recipe, options);
    if (typeof library === "string") return library;
    libraries.push({ target: join(paths.output, recipe.platform, recipe.output.file), library });
  }

  const existing = decode(files.read(paths.manifest));
  let manifest: NativeManifest = { version: 1, libraries: {} };
  if (existing !== undefined) {
    const parsed = parseManifest(existing);
    if ("error" in parsed) {
      return `The existing ${relative(paths.root, paths.manifest)} cannot be read (${parsed.error}); fix or remove it.`;
    }
    manifest = parsed.manifest;
  }
  for (const recipe of recipes) {
    manifest = withEntry(manifest, recipe.name, recipe.platform, recipe.output);
  }
  const text = manifestText(manifest);
  const checked = parseManifest(text);
  if ("error" in checked) return checked.error;
  return publish(deps, libraries, new TextEncoder().encode(text));
}

/** One target up to its checked output: the library's bytes, else the error. */
async function buildTarget(
  deps: BuildDeps,
  recipe: LibraryRecipe,
  options: BuildOptions,
): Promise<Uint8Array | string> {
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
  return library;
}

interface Library {
  target: string;
  library: Uint8Array;
}

/**
 * Writes each library, then the manifest. If any of them cannot be written, every library written
 * so far goes back to what it was (or is removed), so a failed build leaves
 * `.local/build/native/` unchanged.
 */
function publish(
  { files, paths }: BuildDeps,
  libraries: readonly Library[],
  manifest: Uint8Array,
): string | undefined {
  const failed = (path: string, error: unknown) =>
    `Could not write ${relative(paths.root, path)} (${String(error)}).`;
  const written: { target: string; before: Uint8Array | undefined }[] = [];
  const undo = () => {
    for (const { target, before } of written.reverse()) {
      if (before === undefined) files.remove(target);
      else files.replace(target, before);
    }
  };
  for (const { target, library } of libraries) {
    const before = files.read(target);
    try {
      files.makeDirectory(dirname(target));
      files.replace(target, library);
    } catch (error) {
      undo();
      return failed(target, error);
    }
    written.push({ target, before });
  }
  try {
    files.replace(paths.manifest, manifest);
    return undefined;
  } catch (error) {
    undo();
    return failed(paths.manifest, error);
  }
}
