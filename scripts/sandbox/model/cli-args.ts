import type { CliCommand, EngineName, SandboxOs, Target } from "../types/sandbox";

export const USAGE = `Usage: bun scripts/sandbox/cli.ts <command> --os <os> [--engine <engine>]

Commands:
  install    Install Windows once into .local/windows/base/ (about 25 minutes)
  run [--copy <repo path>]... [--fetch <guest path>]... -- <PowerShell command...>
             Run a command in a throwaway VM over the base; the VM and its changes
             are deleted when it ends
  status     Show the Windows base and the running VMs

Options:
  --os <os>          windows (a Windows 11 VM) or debian (not implemented yet); required
  --engine <engine>  podman or docker; by default Podman if installed, else Docker
`;

/** An absolute drive path without spaces or quotes, safe for scp on both sides. */
const GUEST_PATH = /^[A-Za-z]:[\\/][\w.\-\\/]*$/;

const OSES: readonly string[] = ["windows", "debian"] satisfies SandboxOs[];
const ENGINES: readonly string[] = ["podman", "docker"] satisfies EngineName[];

function usage(error: string): CliCommand {
  return { kind: "usage", error };
}

function isTargetOption(option: string | undefined): option is "--os" | "--engine" {
  return option === "--os" || option === "--engine";
}

/** Reads `--os <value>` or `--engine <value>` at args[index] into the target; returns the usage error when it is wrong. */
function readTargetOption(
  args: string[],
  index: number,
  target: Partial<Target>,
): CliCommand | undefined {
  const option = args[index] === "--os" ? "--os" : "--engine";
  const allowed = option === "--os" ? OSES : ENGINES;
  const value = args[index + 1];
  if (value === undefined || value === "--") return usage(`${option} needs a value.`);
  if (!allowed.includes(value)) {
    return usage(`Unknown ${option}: ${value} (expected ${allowed.join(" or ")}).`);
  }
  if (option === "--os") {
    if (target.os !== undefined) return usage("--os is given more than once.");
    target.os = value as SandboxOs;
  } else {
    if (target.engine !== undefined) return usage("--engine is given more than once.");
    target.engine = value as EngineName;
  }
  return undefined;
}

function missingOs(command: string): CliCommand {
  return usage(`${command} needs --os windows or --os debian.`);
}

function parseNoArguments(command: "install" | "status", args: string[]): CliCommand {
  const target: Partial<Target> = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!isTargetOption(args[index])) return usage(`${command} takes no arguments.`);
    const error = readTargetOption(args, index, target);
    if (error !== undefined) return error;
  }
  const { os, engine } = target;
  return os === undefined ? missingOs(command) : { kind: command, os, engine };
}

function parseRun(args: string[]): CliCommand {
  const copy: string[] = [];
  const fetch: string[] = [];
  const target: Partial<Target> = {};
  let index = 0;
  // Options come first; the command starts after `--` or at the first word that is not an
  // option, because `bun run sandbox:run -- <command>` drops the `--` before it reaches us.
  while (index < args.length && args[index] !== "--" && args[index]?.startsWith("--")) {
    const option = args[index] ?? "";
    const value = args[index + 1];
    if (isTargetOption(option)) {
      const error = readTargetOption(args, index, target);
      if (error !== undefined) return error;
      index += 2;
      continue;
    }
    if (option !== "--copy" && option !== "--fetch") {
      return usage(`Unknown option for run: ${option}`);
    }
    if (value === undefined || value === "--") return usage(`${option} needs a value.`);
    if (option === "--fetch" && !GUEST_PATH.test(value)) {
      return usage(`--fetch needs an absolute guest path like C:\\goop\\out.xml, got: ${value}`);
    }
    (option === "--copy" ? copy : fetch).push(value);
    index += 2;
  }
  const { os, engine } = target;
  if (os === undefined) return missingOs("run");
  const command = args.slice(args[index] === "--" ? index + 1 : index).join(" ");
  // Only Windows runs commands so far; cli.ts stops --os debian before this matters (T4).
  if (os === "windows" && command.trim() === "") {
    return usage("run needs a PowerShell command after --.");
  }
  return { kind: "run", os, engine, copy, fetch, command };
}

/** The command line: `install`, `status` or `run [--copy p]... [--fetch p]... -- command`, each with `--os` and an optional `--engine`. */
export function parseCliArgs(argv: string[]): CliCommand {
  const [command, ...rest] = argv;
  switch (command) {
    case "install":
    case "status":
      return parseNoArguments(command, rest);
    case "run":
      return parseRun(rest);
    default:
      return { kind: "usage" };
  }
}
