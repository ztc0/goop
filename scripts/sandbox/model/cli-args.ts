import type { CliCommand, EngineName, SandboxOs } from "../types/sandbox";

export const USAGE = `Usage: bun scripts/sandbox/cli.ts <command> <system> [options]

Commands:
  install <system>  Install Windows once into .local/windows/base/ (about 25 min),
                    or build the Debian image (a few minutes; again to rebuild)
  run <system> [--copy <repo path>]... [--fetch <sandbox path>]... [--] <command...>
                    Run a PowerShell command (windows) or a shell command (debian)
                    in a throwaway sandbox; it and its changes are deleted at the end
  status <system>   Show the Windows base or the Debian image, and running sandboxes

Systems:
  windows           A Windows 11 VM
  debian            A Debian 13 container with systemd

Options:
  --engine <engine> podman or docker; by default Podman if installed, else Docker

Examples:
  bun run sandbox:install debian
  bun run sandbox:run debian uname -a
  bun run sandbox:run windows --copy dist 'Get-ChildItem C:\\goop'
  bun run sandbox:status windows
`;

/** An absolute drive path without spaces or quotes, safe for scp on both sides. */
const GUEST_PATH = /^[A-Za-z]:[\\/][\w.\-\\/]*$/;
/** An absolute POSIX path below / without spaces or quotes, for the Debian container. */
const CONTAINER_PATH = /^\/[\w.\-/]+$/;

const OSES: readonly string[] = ["windows", "debian"] satisfies SandboxOs[];
const ENGINES: readonly string[] = ["podman", "docker"] satisfies EngineName[];

const OS_REPLACED =
  "--os was replaced: write the system right after the command, like: bun run sandbox:run debian uname -a";

function usage(error: string): CliCommand {
  return { kind: "usage", error };
}

/** Reads the system, the first word after the command; returns the usage error when it is missing or wrong. */
function readOs(command: string, word: string | undefined): SandboxOs | CliCommand {
  if (word === "--os") return usage(OS_REPLACED);
  if (word === undefined || word.startsWith("-")) {
    return usage(`${command} needs the system first: windows or debian.`);
  }
  if (!OSES.includes(word)) return usage(`Unknown system: ${word} (expected windows or debian).`);
  return word as SandboxOs;
}

/** Reads `--engine <value>` at args[index]; returns the usage error when it is wrong. */
function readEngine(
  args: string[],
  index: number,
  engine: EngineName | undefined,
): EngineName | CliCommand {
  const value = args[index + 1];
  if (value === undefined || value === "--") return usage("--engine needs a value.");
  if (!ENGINES.includes(value)) {
    return usage(`Unknown --engine: ${value} (expected podman or docker).`);
  }
  if (engine !== undefined) return usage("--engine is given more than once.");
  return value as EngineName;
}

function parseNoCommand(command: "install" | "status", args: string[]): CliCommand {
  const os = readOs(command, args[0]);
  if (typeof os !== "string") return os;
  let engine: EngineName | undefined;
  for (let index = 1; index < args.length; index += 2) {
    if (args[index] === "--os") return usage(OS_REPLACED);
    if (args[index] !== "--engine") {
      return usage(
        `${command} takes no command; to run one, use: bun run sandbox:run <system> <command>`,
      );
    }
    const value = readEngine(args, index, engine);
    if (typeof value !== "string") return value;
    engine = value;
  }
  return { kind: command, os, engine };
}

function parseRun(args: string[]): CliCommand {
  const os = readOs("run", args[0]);
  if (typeof os !== "string") return os;
  const copy: string[] = [];
  const fetch: string[] = [];
  let engine: EngineName | undefined;
  let index = 1;
  // Options come first; the command starts after `--` or at the first word that is not an
  // option, so the `--` is optional (and `bun run sandbox:run -- <command>` drops it anyway).
  while (index < args.length && args[index] !== "--" && args[index]?.startsWith("--")) {
    const option = args[index] ?? "";
    const value = args[index + 1];
    if (option === "--os") return usage(OS_REPLACED);
    if (option === "--engine") {
      const chosen = readEngine(args, index, engine);
      if (typeof chosen !== "string") return chosen;
      engine = chosen;
      index += 2;
      continue;
    }
    if (option !== "--copy" && option !== "--fetch") {
      return usage(`Unknown option for run: ${option}`);
    }
    if (value === undefined || value === "--") return usage(`${option} needs a value.`);
    if (option === "--fetch" && os === "windows" && !GUEST_PATH.test(value)) {
      return usage(`--fetch needs an absolute guest path like C:\\goop\\out.xml, got: ${value}`);
    }
    if (option === "--fetch" && os === "debian" && !CONTAINER_PATH.test(value)) {
      return usage(
        `--fetch needs an absolute container path like /home/goop/goop/out.txt, got: ${value}`,
      );
    }
    (option === "--copy" ? copy : fetch).push(value);
    index += 2;
  }
  const command = args.slice(args[index] === "--" ? index + 1 : index).join(" ");
  if (command.trim() === "") {
    return usage(`run needs a ${os === "windows" ? "PowerShell" : "shell"} command.`);
  }
  return { kind: "run", os, engine, copy, fetch, command };
}

/** The command line: `install <system>`, `status <system>` or `run <system> [--copy p]... [--fetch p]... [--] command`, each with an optional `--engine`. */
export function parseCliArgs(argv: string[]): CliCommand {
  const [command, ...rest] = argv;
  switch (command) {
    case "install":
    case "status":
      return parseNoCommand(command, rest);
    case "run":
      return parseRun(rest);
    default:
      return { kind: "usage" };
  }
}
