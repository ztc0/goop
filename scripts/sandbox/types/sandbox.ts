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
}

export interface ReadinessPolicy {
  intervalMs: number;
  timeoutMs: number;
}

export interface RunRequest {
  /** Repo paths uploaded to C:\goop\ before the command. */
  copy: string[];
  /** Guest paths downloaded into .temp/windows/results/<run-id>/ after it. */
  fetch: string[];
  /** PowerShell command text, piped to the guest through stdin. */
  command: string;
}

/** The machine a command targets, chosen with `--os`. */
export type SandboxOs = "windows" | "debian";

export type CliCommand =
  | { kind: "install"; os: SandboxOs }
  | { kind: "status"; os: SandboxOs }
  | ({ kind: "run"; os: SandboxOs } & RunRequest)
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
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult>;
}

/** The Podman commands the VM needs, always against the repo-local storage. */
export interface Podman {
  startInstall(password: string): Promise<ProcessResult>;
  createOverlay(runId: string): Promise<ProcessResult>;
  startRun(runId: string, password: string): Promise<ProcessResult>;
  stop(name: string): Promise<ProcessResult>;
  remove(name: string): Promise<ProcessResult>;
  logs(name: string): Promise<ProcessResult>;
  listRunning(): Promise<ProcessResult>;
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
  podman: Podman;
  guest: GuestShell;
  files: FileStore;
  clock: Clock;
  output: Output;
  random: RandomSource;
  /** Aborted on Ctrl+C, so the services still clean up. */
  signal: AbortSignal;
}
