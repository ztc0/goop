// The libraries `bun run build:native` writes to `.local/build/native/` (S5): while
// developing, goop and the tests load them from there. Each call reads the manifest and hashes the
// library again, so a file changed since the last load is refused (S4). Nothing is written here:
// the folder belongs to the build script.
import { join } from "node:path";
import { nodeNativeFiles } from "@/shared/vault/native/adapters/native-library-folder";
import {
  hashMismatch,
  missingBuiltLibrary,
  missingManifest,
  parseNativeManifest,
  pinnedLibrary,
} from "@/shared/vault/native/model/native-library";
import type {
  NativeFiles,
  NativePlatform,
  VerifiedLibraryPath,
} from "@/shared/vault/native/types/native-library";

export interface BuiltNativeLibraryOptions {
  /** The build's output folder, `.local/build/native/`, holding `manifest.json`. */
  folder: string;
  /** The library's name in the manifest, like `sqlite3mc`. */
  name: string;
  platform: NativePlatform;
  files?: NativeFiles;
  sha256?: (bytes: Uint8Array) => string;
}

const sha256Hex = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** The path of `<folder>/<platform>/<file>` once its sha256 matched the manifest, for dlopen. */
export async function builtNativeLibrary(
  options: BuiltNativeLibraryOptions,
): Promise<VerifiedLibraryPath> {
  const files = options.files ?? nodeNativeFiles();
  const sha256 = options.sha256 ?? sha256Hex;
  const manifestPath = join(options.folder, "manifest.json");
  const manifest = await files.read(manifestPath);
  if (!manifest) throw missingManifest(manifestPath);
  const pinned = pinnedLibrary(
    parseNativeManifest(new TextDecoder().decode(manifest)),
    options.name,
    options.platform,
  );
  const path = join(options.folder, options.platform, pinned.file);
  const bytes = await files.read(path);
  if (!bytes) throw missingBuiltLibrary(pinned, path);
  const actual = sha256(bytes);
  if (actual !== pinned.sha256) throw hashMismatch(pinned, path, actual);
  return path as VerifiedLibraryPath;
}
