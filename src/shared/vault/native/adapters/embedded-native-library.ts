// The libraries `bun run build` embeds in the executable (S6). goop reads their bytes from
// itself, checks them against the embedded manifest and writes them to its private folder
// `<GOOP_HOME>/lib/native/<sha256>/` for dlopen. It never hands an embedded path to dlopen, so
// Bun's own extraction of native files (oven-sh/bun#30717, #30962, #44083) never runs.
import { nativeLibraryFolder } from "@/shared/vault/native/adapters/native-library-folder";
import {
  EMBEDDED_MANIFEST,
  missingEmbeddedManifest,
  missingLibrary,
  parseNativeManifest,
  pinnedLibrary,
} from "@/shared/vault/native/model/native-library";
import type {
  EmbeddedFile,
  NativeFiles,
  NativePlatform,
  VerifiedLibraryPath,
} from "@/shared/vault/native/types/native-library";

export interface EmbeddedNativeLibraryOptions {
  /** `GOOP_HOME`; the library goes under its `lib/native/`. */
  goopHome: string;
  /** The library's name in the manifest, like `sqlite3mc`. */
  name: string;
  platform: NativePlatform;
  /** The executable's embedded files, from `bunEmbeddedFiles()`. */
  embedded: readonly EmbeddedFile[];
  files?: NativeFiles;
  sha256?: (bytes: Uint8Array) => string;
}

/** The files embedded in this executable; none when goop runs from source. */
export function bunEmbeddedFiles(): EmbeddedFile[] {
  if (!Bun.isStandaloneExecutable) return [];
  return Bun.embeddedFiles.map((blob) => ({
    name: (blob as Blob & { name?: string }).name ?? "",
    bytes: () => blob.bytes(),
  }));
}

/**
 * The path of the extracted library once the embedded bytes and the copy on disk both matched the
 * embedded manifest, for `sqlite3mcEngine({ library })`. Call it before every load.
 */
export async function embeddedNativeLibrary(
  options: EmbeddedNativeLibraryOptions,
): Promise<VerifiedLibraryPath> {
  const byName = (name: string) => options.embedded.find((file) => file.name === name);
  const manifest = byName(EMBEDDED_MANIFEST);
  if (!manifest) throw missingEmbeddedManifest();
  const pinned = pinnedLibrary(
    parseNativeManifest(new TextDecoder().decode(await manifest.bytes())),
    options.name,
    options.platform,
  );
  const library = byName(pinned.file);
  if (!library) throw missingLibrary(pinned, "this goop executable");
  const folder = nativeLibraryFolder({
    goopHome: options.goopHome,
    platform: options.platform.startsWith("win32") ? "win32" : "linux",
    ...(options.files && { files: options.files }),
    ...(options.sha256 && { sha256: options.sha256 }),
  });
  return folder.verifiedPath(pinned, await library.bytes());
}
