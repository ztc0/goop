/** The platforms goop ships native libraries for, as `<process.platform>-<process.arch>`. */
export type NativePlatform = "linux-x64" | "win32-x64";

/** One library file of one platform, as the build pinned it. */
export interface PinnedFile {
  /** A plain file name, never a path. */
  file: string;
  /** 64 lowercase hex characters. */
  sha256: string;
  /** The SQLite version the library reports, for the SQLite builds. */
  sqliteVersion?: string;
}

/** The build's manifest: `{ "version": 1, "libraries": { "<name>": { "<platform>": file } } }`. */
export interface NativeManifest {
  version: 1;
  libraries: Record<string, Partial<Record<NativePlatform, PinnedFile>>>;
}

/** A library picked from the manifest for this platform, ready to check and load. */
export interface PinnedLibrary extends PinnedFile {
  name: string;
}

/** Where goop takes its native libraries from: the build folder (S5) or itself (S6). */
export type NativeLibrarySource = "built" | "embedded";

/** A file `bun run build` embedded in the executable, found by its plain name. */
export interface EmbeddedFile {
  name: string;
  bytes(): Promise<Uint8Array>;
}

declare const verified: unique symbol;

/**
 * A library path whose file matched its pinned sha256 when `vault/native` returned it. Only
 * `vault/native` makes one, so `vault/storage` cannot load a path nobody checked (S4).
 */
export type VerifiedLibraryPath = string & { readonly [verified]: true };

/** The file system calls of the native library folders, kept thin so every decision is testable. */
export interface NativeFiles {
  /** The file's bytes, or undefined when there is no such file. */
  read(path: string): Promise<Uint8Array | undefined>;
  /** Creates the folder and its parents, and gives the folder this mode where modes exist. */
  makeFolder(path: string, mode: number): Promise<void>;
  /** Creates a new file; fails when it already exists. */
  write(path: string, bytes: Uint8Array, mode: number): Promise<void>;
  setMode(path: string, mode: number): Promise<void>;
  /** Replaces `to` atomically. */
  rename(from: string, to: string): Promise<void>;
  /** Removes the file; nothing happens when it is already gone. */
  remove(path: string): Promise<void>;
}
