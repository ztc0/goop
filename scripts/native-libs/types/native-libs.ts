import type { EngineName, Output, PodmanStorage, ProcessRunner } from "@scripts/shared/containers";

/** The platform keys of `.local/build/native/`, the same ones `src/shared/vault/native` reads. */
export type NativePlatform = "linux-x64" | "win32-x64";

/** A file fetched over https; `maxBytes` stops a download that grows past it. */
export interface RemoteFile {
  name: string;
  url: string;
  maxBytes: number;
}

/** A remote file trusted only once its sha256 matches the pin. */
export interface PinnedDownload extends RemoteFile {
  sha256: string;
}

/** A release's checksum list, signed with Cosign keyless by a pinned identity and issuer. */
export interface SignedChecksums {
  list: RemoteFile;
  signature: RemoteFile;
  certificate: RemoteFile;
  /** The workflow that must have signed it (Fulcio certificate SAN). */
  identity: string;
  /** The OIDC issuer of that workflow. */
  issuer: string;
}

/** A Debian package of the build image and the version it must have. */
export interface ToolchainPackage {
  name: string;
  version: string;
}

/** One library of the manifest: its file in the platform folder and its sha256. */
export interface LibraryEntry {
  file: string;
  sha256: string;
  sqliteVersion?: string;
}

/** `.local/build/native/manifest.json`: every built library, by name and platform. */
export interface NativeManifest {
  version: 1;
  libraries: Record<string, Partial<Record<NativePlatform, LibraryEntry>>>;
}

/** How one library is built for one platform, with every input and the output pinned. */
export interface LibraryRecipe {
  name: string;
  platform: NativePlatform;
  /** The source archive; it is mounted read-only into the container as /build/input/<name>. */
  archive: PinnedDownload;
  /** The checksum list that `--verify-signature` checks and that must list the archive's pin. */
  signed: SignedChecksums;
  /** The local tag of the build image. */
  image: string;
  /** The Containerfile, from the repo root; its folder is the whole build context. */
  containerfile: string;
  toolchain: readonly ToolchainPackage[];
  environment: Readonly<Record<string, string>>;
  /**
   * What the container runs: it extracts into /build/src, writes the library into /build/out
   * and the installed toolchain (`dpkg-query` lines) into /build/out/toolchain.txt.
   */
  script: string;
  /** The source file whose declared version is checked after the build. */
  source: {
    file: string;
    label: string;
    expected: string;
    version(text: string): string | undefined;
  };
  /** The pinned output: what the manifest records once the build matches it. */
  output: LibraryEntry;
}

/** The engine the build runs: its command prefix, with Podman's repo-local storage flags. */
export interface BuildEngine {
  name: EngineName;
  command: string[];
  env: Record<string, string>;
  /** Folders created before the first call (Podman's storage). */
  directories: string[];
  /** Docker runs the build as the host user, so the output files are not owned by root. */
  user?: string;
}

/** Where the build reads and writes, all inside the repo. */
export interface NativeLibsPaths {
  root: string;
  /** `.local/build/native/`: the manifest and one folder per platform. */
  output: string;
  manifest: string;
  /** Parents of the fresh folders each run creates. */
  downloads: string;
  extract: string;
  staging: string;
  podman: PodmanStorage;
}

export interface NativeLibsFiles {
  /** Creates a new empty folder below the parent and returns its path. */
  freshDirectory(parent: string, prefix: string): string;
  makeDirectory(path: string): void;
  /** The file's bytes, or undefined when it does not exist. */
  read(path: string): Uint8Array | undefined;
  /** Creates a file that must not exist yet. */
  writeNew(path: string, content: Uint8Array, mode?: number): void;
  /** Writes next to the target, then renames over it, so a reader never sees half a file. */
  replace(path: string, content: Uint8Array): void;
  /** Removes the file; nothing happens when it is already gone. */
  remove(path: string): void;
}

export interface BuildDeps {
  paths: NativeLibsPaths;
  engine: BuildEngine;
  runner: ProcessRunner;
  files: NativeLibsFiles;
  /** Downloads a URL into memory, at most `maxBytes`; throws on any failure. */
  download(url: string, maxBytes: number): Promise<Uint8Array>;
  now(): number;
  output: Output;
}

/** The pinned cosign release that checks a signature. */
export interface CosignPin extends PinnedDownload {
  version: string;
}

export interface BuildOptions {
  verifySignature: boolean;
  cosign: CosignPin;
}
