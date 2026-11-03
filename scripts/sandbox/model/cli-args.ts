import type { CliCommand, SandboxOs } from "../types/sandbox";

export const USAGE = `Usage: bun scripts/sandbox/cli.ts <command> --os <os>

Commands:
  install    Install Windows once into .local/windows/base/ (about 25 minutes)
  run [--copy <repo path>]... [--fetch <guest path>]... -- <PowerShell command...>
             Run a command in a throwaway VM over the base; the VM and its changes
             are deleted when it ends
  status     Show the Windows base and the running VMs

Options:
  --os <os>  windows (a Windows 11 VM) or debian (not implemented yet); required
`;

/** An absolute drive path without spaces or quotes, safe for scp on both sides. */
const GUEST_PATH = /^[A-Za-z]:[\\/][\w.\-\\/]*$/;

const OSES: readonly string[] = ["windows", "debian"] satisfies SandboxOs[];

function usage(error: string): CliCommand {
  return { kind: "usage", error };
}

/** Reads `--os <value>` at args[index]; returns the usage error when it is wrong. */
function readOs(args: string[], index: number, os: SandboxOs | undefined): SandboxOs | CliCommand {
  const value = args[index + 1];
  if (value === undefined || value === "--") return usage("--os needs a value.");
  if (!OSES.includes(value)) return usage(`Unknown --os: ${value} (expected windows or debian).`);
  if (os !== undefined) return usage("--os is given more than once.");
  return value as SandboxOs;
}

function missingOs(command: string): CliCommand {
  return usage(`${command} needs --os windows or --os debian.`);
}

function parseNoArguments(command: "install" | "status", args: string[]): CliCommand {
  let os: SandboxOs | undefined;
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] !== "--os") return usage(`${command} takes no arguments.`);
    const read = readOs(args, index, os);
    if (typeof read !== "string") return read;
    os = read;
  }
  return os === undefined ? missingOs(command) : { kind: command, os };
}

function parseRun(args: string[]): CliCommand {
  const copy: string[] = [];
  const fetch: string[] = [];
  let os: SandboxOs | undefined;
  let index = 0;
  // Options come first; the command starts after `--` or at the first word that is not an
  // option, because `bun run sandbox:run -- <command>` drops the `--` before it reaches us.
  while (index < args.length && args[index] !== "--" && args[index]?.startsWith("--")) {
    const option = args[index] ?? "";
    const value = args[index + 1];
    if (option === "--os") {
      const read = readOs(args, index, os);
      if (typeof read !== "string") return read;
      os = read;
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
  if (os === undefined) return missingOs("run");
  const command = args.slice(args[index] === "--" ? index + 1 : index).join(" ");
  if (command.trim() === "") return usage("run needs a PowerShell command after --.");
  return { kind: "run", os, copy, fetch, command };
}

/** The command line: `install`, `status` or `run [--copy p]... [--fetch p]... -- command`, each with `--os`. */
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
