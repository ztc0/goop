import type { CliCommand } from "../types/windows-vm";

export const USAGE = `Usage: bun scripts/windows-vm/cli.ts <command>

Commands:
  install    Install Windows once into .local/windows/base/ (about 25 minutes)
  run [--copy <repo path>]... [--fetch <guest path>]... -- <PowerShell command...>
             Run a command in a throwaway VM over the base; the VM and its changes
             are deleted when it ends
  status     Show the Windows base and the running VMs
`;

/** An absolute drive path without spaces or quotes, safe for scp on both sides. */
const GUEST_PATH = /^[A-Za-z]:[\\/][\w.\-\\/]*$/;

function usage(error: string): CliCommand {
  return { kind: "usage", error };
}

function parseRun(args: string[]): CliCommand {
  const copy: string[] = [];
  const fetch: string[] = [];
  let index = 0;
  while (index < args.length && args[index] !== "--") {
    const option = args[index] ?? "";
    const value = args[index + 1];
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
  const command = args.slice(index + 1).join(" ");
  if (command.trim() === "") return usage("run needs a PowerShell command after --.");
  return { kind: "run", copy, fetch, command };
}

/** The command line: `install`, `status` or `run [--copy p]... [--fetch p]... -- command`. */
export function parseCliArgs(argv: string[]): CliCommand {
  const [command, ...rest] = argv;
  switch (command) {
    case "install":
    case "status":
      return rest.length === 0 ? { kind: command } : usage(`${command} takes no arguments.`);
    case "run":
      return parseRun(rest);
    default:
      return { kind: "usage" };
  }
}
