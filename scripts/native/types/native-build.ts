import type { EngineName, Output, ProcessRunner } from "../../sandbox/types/sandbox";

/** The platforms goop ships a native library for; Windows joins with the CI job (T5). */
export type NativePlatform = "linux-x64";

/** A release archive pinned by URL and sha256; nothing in it is trusted before the hash matches. */
export interface PinnedArchive {
  name: string;
  url: string;
  sha256: string;
  /** The only file taken out of the archive. */
  member: string;
  /** The SQLite version the amalgamation must declare. */
  sqliteVersion: string;
}

/** A Debian package of the build image and the version it must have. */
export interface ToolchainPackage {
  name: string;
  version: string;
}

/** One built library, as embedded in goop (S8). */
export interface LibraryEntry {
  file: string;
  sha256: string;
  sqliteVersion: string;
}

/** `.local/build/native/manifest.json`: the sha256 values goop pins at build time (S8). */
export interface NativeManifest {
  version: 1;
  libraries: {
    sqlite3mc: Record<NativePlatform, LibraryEntry>;
  };
}

/** Where the build reads and writes, all inside the repo. */
export interface NativePaths {
  root: string;
  containerfile: string;
  /** Podman's repo-local storage, created before the first Podman call. */
  containerDirectories: string[];
  /** `.local/build/native/`, which holds the manifest and one folder per platform. */
  output: string;
  library: string;
  manifest: string;
  /** Parents of the fresh folders each run creates. */
  downloads: string;
  extract: string;
  staging: string;
}

export type BuildCommand = { engine?: EngineName | undefined } | { error: string };

/** The engine the build runs: its command prefix, with Podman's repo-local storage flags. */
export interface BuildEngine {
  name: EngineName;
  /** The program and its global flags, for example `podman --root ...`. */
  command: string[];
  env: Record<string, string>;
  /** Docker runs the build as the host user, so its output files are not owned by root. */
  user?: string;
}

export interface NativeFiles {
  /** Creates a new empty folder below the parent and returns its path. */
  freshDirectory(parent: string, prefix: string): string;
  makeDirectory(path: string): void;
  readBytes(path: string): Uint8Array;
  readText(path: string): string;
  /** Writes next to the target, then renames over it, so a reader never sees half a file. */
  replaceFile(path: string, content: Uint8Array | string): void;
  writeFile(path: string, content: Uint8Array): void;
}

export interface NativeBuildDeps {
  paths: NativePaths;
  engine: BuildEngine;
  runner: ProcessRunner;
  files: NativeFiles;
  /** Downloads a URL into memory, at most `maxBytes`; throws on any failure. */
  download(url: string, maxBytes: number): Promise<Uint8Array>;
  now(): number;
  output: Output;
}
