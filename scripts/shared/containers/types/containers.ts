/** The container engine, chosen with `--engine` or detected. */
export type EngineName = "podman" | "docker";

/** Where Podman keeps images, containers and temporary files, all inside the repo. */
export interface PodmanStorage {
  /** Podman graph root: images and container layers. */
  containerStorage: string;
  containerRunRoot: string;
  /** Podman --tmpdir and TMPDIR for image pulls. */
  containerTmp: string;
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

export interface Output {
  info(line: string): void;
  error(line: string): void;
}
