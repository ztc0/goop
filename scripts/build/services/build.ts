import { basename, join, relative } from "node:path";
import { NATIVE_LIBRARIES, nativeFolder, notBuilt } from "@scripts/build/model/build";
import type { BuildDeps, BuildRequest } from "@scripts/build/types/build";
import { NativeLibraryError, NativeManifestError } from "@/shared/vault";

/**
 * Compiles goop with the host platform's native libraries and the manifest embedded (S6). Each
 * library is checked against the manifest first, with the same check goop runs before a load, so
 * a missing or changed build stops here and nothing is compiled.
 */
export async function buildExecutable(deps: BuildDeps, request: BuildRequest): Promise<number> {
  const folder = nativeFolder(request.root);
  const libraries: string[] = [];
  for (const name of NATIVE_LIBRARIES) {
    try {
      libraries.push(await deps.verify({ folder, name, platform: request.platform }));
    } catch (error) {
      if (!(error instanceof NativeLibraryError || error instanceof NativeManifestError)) {
        throw error;
      }
      deps.output.error(error.message);
      deps.output.error(notBuilt(request.platform));
      return 1;
    }
  }

  const result = await deps.compiler.compile({
    entry: request.entry,
    outfile: request.outfile,
    files: [join(folder, "manifest.json"), ...libraries],
  });
  if (!result.ok) {
    deps.output.error(result.error);
    deps.output.error("bun build failed: goop was not built.");
    return 1;
  }
  const embedded = NATIVE_LIBRARIES.map((name, i) => `${name} (${basename(libraries[i] ?? "")})`);
  deps.output.info(
    `Built ${relative(request.root, request.outfile)} for ${request.platform} with ${embedded.join(", ")} and the native manifest embedded.`,
  );
  return 0;
}
