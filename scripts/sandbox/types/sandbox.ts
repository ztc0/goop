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

/** The container engine that runs the sandbox, chosen with `--engine` or detected (S3). */
export type EngineName = "podman" | "docker";

/** What every command takes: the target and, optionally, the engine. */
export interface Target {
  os: SandboxOs;
  engine?: EngineName | undefined;
}

export type CliCommand =
  | ({ kind: "install" } & Target)
  | ({ kind: "status" } & Target)
  | ({ kind: "run" } & Target & RunRequest)
  | { kind: "usage"; error?: string };

export interface OemFiles {
  installBat: string;
  setupPs1: string;
}

export interface ProcessRequest {
  command: string[];
  /** Added to the current environment. */
  env?: Record<string, string>;
  /** Text written to the child's stdin. */
  stdin?: string;
  /** Stream stdout and stderr to the terminal instead of capturing them. */
  stream?: boolean;
  /** Attach stdin, stdout and stderr to the user's terminal, for an interactive program. */
  interactive?: boolean;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult>;
}

/** How `exec` runs a command inside a container. */
export interface ExecOptions {
  user?: string;
  workdir?: string;
  env?: Record<string, string>;
  /** Stream the output to the terminal instead of capturing it. */
  stream?: boolean;
  /** Run with `-it`, attached to the user's terminal. */
  interactive?: boolean;
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

export interface Output {
  info(line: string): void;
  error(line: string): void;
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
