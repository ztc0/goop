// Arguments that Podman and Docker take in the same form, whatever the container runs.
import { dirname } from "node:path";
import type { ExecOptions } from "@scripts/shared/containers/types/containers";

export function removeArgs(name: string): string[] {
  return ["rm", name];
}

export function logsArgs(name: string): string[] {
  return ["logs", "--tail", "50", name];
}

export function listRunningArgs(prefix: string): string[] {
  return ["ps", "--filter", `name=${prefix}`, "--format", "{{.Names}}\t{{.Status}}"];
}

/** The build context is the Containerfile's own folder, so nothing else in the repo is sent. */
export function buildArgs(tag: string, containerfile: string): string[] {
  return ["build", "--tag", tag, "--file", containerfile, dirname(containerfile)];
}

export function imageSizeArgs(tag: string): string[] {
  return ["image", "inspect", "--format", "{{.Size}}", tag];
}

export function execArgs(name: string, command: string[], options: ExecOptions = {}): string[] {
  const { user, workdir, env = {}, interactive } = options;
  return [
    "exec",
    ...(interactive ? ["-it"] : []),
    ...(user === undefined ? [] : ["--user", user]),
    ...(workdir === undefined ? [] : ["--workdir", workdir]),
    ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    name,
    ...command,
  ];
}

export function copyInArgs(name: string, localPath: string, containerDirectory: string): string[] {
  return ["cp", localPath, `${name}:${containerDirectory}`];
}

export function copyOutArgs(name: string, containerPath: string, localDirectory: string): string[] {
  return ["cp", `${name}:${containerPath}`, localDirectory];
}
