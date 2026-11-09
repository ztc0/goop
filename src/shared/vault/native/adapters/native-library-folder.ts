// The native libraries' private folder (S6, ADR 0001). `bun build --compile` keeps embedded files
// where dlopen cannot read them, so goop itself copies each library to
// `<GOOP_HOME>/lib/native/<sha256>/` and hashes it against the build's pin before every load: a
// mismatch is never loaded.
//
// Check-then-load gap: the copy is hashed, then the caller dlopens it by path. A process running
// as the same user could swap the file in between. ADR 0001's threat model accepts that: such a
// process can already read goop's memory and files, and the 0700 folder keeps other users out.
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  hashMismatch,
  missingLibrary,
  nativeFileMode,
  nativeLibraryPath,
} from "@/shared/vault/native/model/native-library";
import type {
  NativeFiles,
  PinnedLibrary,
  VerifiedLibraryPath,
} from "@/shared/vault/native/types/native-library";

const FOLDER_MODE = 0o700;
const WRITABLE_MODE = 0o600;

export interface NativeLibraryFolderOptions {
  /** `GOOP_HOME`; the libraries go under its `lib/native/`. */
  goopHome: string;
  files?: NativeFiles;
  sha256?: (bytes: Uint8Array) => string;
  platform?: string;
}

const sha256Hex = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** The real file system. Windows has no folder modes, so `makeFolder` only creates it there. */
export function nodeNativeFiles(platform: string = process.platform): NativeFiles {
  return {
    async read(path) {
      try {
        return new Uint8Array(await readFile(path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
    async makeFolder(path, mode) {
      await mkdir(path, { recursive: true, mode });
      // mkdir leaves an existing folder as it is and applies the umask to a new one.
      if (platform !== "win32") await chmod(path, mode);
    },
    write: (path, bytes, mode) => writeFile(path, bytes, { flag: "wx", mode }),
    setMode: (path, mode) => chmod(path, mode),
    rename: (from, to) => rename(from, to),
    remove: (path) => rm(path, { force: true }),
  };
}

export function nativeLibraryFolder(options: NativeLibraryFolderOptions) {
  const platform: string = options.platform ?? process.platform;
  const files = options.files ?? nodeNativeFiles(platform);
  const sha256 = options.sha256 ?? sha256Hex;

  /** Writes a temporary file next to the target, makes it read-only and renames it over. */
  async function install(folder: string, target: string, bytes: Uint8Array, replacing: boolean) {
    await files.makeFolder(folder, FOLDER_MODE);
    const temp = join(folder, `.${randomUUID()}.part`);
    try {
      await files.write(temp, bytes, WRITABLE_MODE);
      await files.setMode(temp, nativeFileMode(platform));
      // Windows refuses to rename over a read-only file.
      if (replacing) await files.setMode(target, WRITABLE_MODE);
      await files.rename(temp, target);
    } catch (error) {
      await files.remove(temp);
      throw error;
    }
  }

  return {
    /**
     * The path of an extracted copy that matches `pinned.sha256` right now, for
     * `sqlite3mcEngine({ library })`. Call it before every load: it hashes the copy each time.
     * `source` is the embedded library, as bytes or a path; it is checked first.
     */
    async verifiedPath(
      pinned: PinnedLibrary,
      source: Uint8Array | string,
    ): Promise<VerifiedLibraryPath> {
      const { folder, file: target } = nativeLibraryPath(options.goopHome, pinned);
      const bytes = typeof source === "string" ? await files.read(source) : source;
      if (!bytes) throw missingLibrary(pinned, String(source));
      const sourceHash = sha256(bytes);
      if (sourceHash !== pinned.sha256) {
        throw hashMismatch(
          pinned,
          typeof source === "string" ? source : "the embedded copy",
          sourceHash,
        );
      }

      const extracted = await files.read(target);
      if (extracted && sha256(extracted) === pinned.sha256) return target as VerifiedLibraryPath;

      // Missing or changed: replace it once from the verified source, then check it again.
      await install(folder, target, bytes, extracted !== undefined);
      const installed = await files.read(target);
      if (!installed) throw missingLibrary(pinned, target);
      const installedHash = sha256(installed);
      if (installedHash !== pinned.sha256) throw hashMismatch(pinned, target, installedHash);
      return target as VerifiedLibraryPath;
    },
  };
}
