import type {
  EngineName,
  ExecOptions,
  Output,
  ProcessResult,
  ProcessRunner,
} from "@scripts/shared/containers";

/** Where the sandbox keeps everything, all inside the repo (S3). */
export interface SandboxPaths {
  root: string;
  /** Podman graph root: images and container layers. */
  containerStorage: string;
  containerRunRoot: string;
  /** Podman --tmpdir and TMPDIR for image pulls. */
  containerTmp: string;
  windows: string;
  /** The installed Windows: dockur's /storage after the first install. */
  base: string;
  baseDisk: string;
  /** install.bat and setup.ps1, mounted as /oem during the install. */
  oem: string;
  ssh: string;
  sshKey: string;
  sshPublicKey: string;
  password: string;
  temp: string;
  knownHosts: string;
  /** Throwaway storage, one folder per run (S5). */
  runs: string;
  results: string;
  /** The Debian image's build recipe (S2). */
  debianContainerfile: string;
  /** Files fetched from Debian runs, one folder per run. */
  debianResults: string;
  /** Verified Bun executables for the sandbox suite, one folder per version and hash (T8). */
  bunCache: string;
  /** Parent of the fresh folder each Bun download gets. */
  downloads: string;
  /** The staged repo copy and Bun of each suite run, deleted when it ends. */
  suite: string;
}

export interface ReadinessPolicy {
  intervalMs: number;
  timeoutMs: number;
}

export interface RunRequest {
  /** Repo paths uploaded to C:\goop\ (Windows) or /home/goop/goop/ (Debian) before the command. */
  copy: string[];
  /** Sandbox paths downloaded into .temp/<os>/results/<run-id>/ after it. */
  fetch: string[];
  /** PowerShell (Windows) or bash (Debian) command text; empty on Debian for an interactive shell. */
  command: string;
}

/** The machine a command targets, the word right after the command (`run debian ...`). */
export type SandboxOs = "windows" | "debian";

/** What every command takes: the target and, optionally, the engine. */
export interface Target {
  os: SandboxOs;
  engine?: EngineName | undefined;
}

export type CliCommand =
  | ({ kind: "install" } & Target)
  | ({ kind: "status" } & Target)
  | ({ kind: "test" } & Target)
  | ({ kind: "run" } & Target & RunRequest)
  | { kind: "usage"; error?: string };

/** The Bun builds the sandboxes need: Windows x64, and Linux x64 for every Linux system. */
export type BunTarget = "windows-x64" | "linux-x64";

/** A Bun release build, pinned by the sha256 of its zip and of the executable inside (T8). */
export interface PinnedBun {
  version: string;
  asset: string;
  url: string;
  sha256: string;
  /** The executable's path inside the zip. */
  member: string;
  /** The executable's name in the sandbox. */
  binary: string;
  binarySha256: string;
}

/**
 * The native platforms `bun run native-libs:build` writes to `.local/build/native/`. A copy of the
 * build's names, since the sandbox never imports the build's internals.
 */
export type NativePlatform = "linux-x64" | "win32-x64";

/** How a system runs the whole suite (T8): adding a system is one more plan. */
export interface SuitePlan {
  bun: PinnedBun;
  /** The folder of `.local/build/native/` the suite's machine loads its native libraries from. */
  native: NativePlatform;
  /** The shell the suite command is written for. */
  shell: "powershell" | "bash";
  /** Where `--copy` puts the uploads in the sandbox. */
  uploads: string;
}

export interface OemFiles {
  installBat: string;
  setupPs1: string;
}

/** The container commands the sandboxes need, whatever the engine (S4). */
export interface ContainerEngine {
  /** The engine's command, named in messages. */
  name: EngineName;
  startInstall(password: string): Promise<ProcessResult>;
  createOverlay(runId: string): Promise<ProcessResult>;
  startRun(runId: string, password: string): Promise<ProcessResult>;
  stop(name: string): Promise<ProcessResult>;
  remove(name: string): Promise<ProcessResult>;
  logs(name: string): Promise<ProcessResult>;
  /** The running containers whose name starts with the prefix, one per line. */
  listRunning(prefix: string): Promise<ProcessResult>;
  /** Builds an image from a Containerfile, streaming the build output. */
  buildImage(tag: string, containerfile: string): Promise<ProcessResult>;
  /** Prints the image size in bytes; fails when the image does not exist. */
  imageSize(tag: string): Promise<ProcessResult>;
  /** Starts a detached container with systemd as process 1. */
  startSystemd(name: string, image: string): Promise<ProcessResult>;
  exec(name: string, command: string[], options?: ExecOptions): Promise<ProcessResult>;
  copyIn(name: string, localPath: string, containerDirectory: string): Promise<ProcessResult>;
  copyOut(name: string, containerPath: string, localDirectory: string): Promise<ProcessResult>;
  /** Stops and deletes a container in one step. */
  forceRemove(name: string): Promise<ProcessResult>;
  /** The command a user runs from the repo root to remove a container the sandbox could not. */
  manualRemoveCommand(name: string): string;
}

/** The guest reached through SSH and scp. */
export interface GuestShell {
  generateKey(): Promise<ProcessResult>;
  isReachable(): Promise<boolean>;
  isSetupDone(): Promise<boolean>;
  prepareUploads(): Promise<ProcessResult>;
  upload(localPath: string): Promise<ProcessResult>;
  download(guestPath: string, destination: string): Promise<ProcessResult>;
  /** Runs PowerShell in the guest, streams its output and returns its exit code. */
  execute(command: string): Promise<number>;
}

export interface FileEntry {
  name: string;
  size: number;
}

export interface FileStore {
  exists(path: string): boolean;
  makeDirectory(path: string): void;
  writeFile(path: string, content: string, mode?: number): void;
  readText(path: string): string;
  readBytes(path: string): Uint8Array;
  /** Writes next to the target, then renames over it, so a reader never sees half a file. */
  writeBytes(path: string, content: Uint8Array, mode?: number): void;
  /** Creates a new empty folder below the parent and returns its path. */
  freshDirectory(parent: string, prefix: string): string;
  /** Regular files directly inside a folder. */
  listFiles(directory: string): FileEntry[];
  copyFile(from: string, to: string): void;
  removeDirectory(path: string): void;
}

export interface Clock {
  now(): number;
  /** Resolves after the delay, or early when the signal aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface RandomSource {
  bytes(count: number): Uint8Array;
}

export interface SandboxDeps {
  paths: SandboxPaths;
  engine: ContainerEngine;
  guest: GuestShell;
  files: FileStore;
  clock: Clock;
  output: Output;
  random: RandomSource;
  /** Aborted on Ctrl+C, so the services still clean up. */
  signal: AbortSignal;
  /** stdin and stdout are a terminal, which the Debian shell needs. */
  terminal: boolean;
}

/** What `test` needs on top of a run: git for the repo copy and an https download (T8). */
export interface SuiteDeps extends SandboxDeps {
  runner: ProcessRunner;
  /** Downloads a URL into memory, at most `maxBytes`; throws on any failure. */
  download(url: string, maxBytes: number): Promise<Uint8Array>;
}
