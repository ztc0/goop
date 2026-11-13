import type { EngineName, Output, PodmanStorage, ProcessResult } from "@scripts/shared/containers";

/** Every path `bun run dev` uses, all inside the repo (S7). */
export interface DevPaths extends PodmanStorage {
  root: string;
  /** The dev image's build recipe. */
  containerfile: string;
  /** The container's main process, run from the mounted repo. */
  entrypoint: string;
  /** Mounted over the repo's node_modules/, filled inside the container. */
  nodeModules: string;
  /** `.temp/dev/`: goop's development data and the insecure development key (S8). */
  devTemp: string;
  /** `.temp/dev/home/`: GOOP_HOME inside the container. */
  home: string;
  /** `.temp/tmp/`: TMPDIR inside the container. */
  tmp: string;
  /** `.local/cache/bun/`: Bun's install cache, shared with the host. */
  bunCache: string;
}

/** How an engine call meets the terminal. */
export type CallMode = "capture" | "stream" | "interactive";

/** Podman (repo-local storage) or Docker; the arguments are the same for both. */
export interface DevEngine {
  name: EngineName;
  /** `--user` of the container: Docker runs it as the host user; rootless Podman needs none. */
  user?: string;
  call(args: string[], mode?: CallMode): Promise<ProcessResult>;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface Folders {
  /** Creates each folder and its parents when missing. */
  ensure(directories: readonly string[]): void;
}

export interface DevDeps {
  paths: DevPaths;
  engine: DevEngine;
  folders: Folders;
  clock: Clock;
  output: Output;
  /** stdin and stdout are a terminal, so goop gets `-it`. */
  terminal: boolean;
}

export type DevCommand =
  | { kind: "goop"; args: string[] }
  | { kind: "logs" }
  | { kind: "stop" }
  | { kind: "usage"; error?: string };
