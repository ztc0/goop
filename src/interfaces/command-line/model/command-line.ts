// What `goop` was asked to do (S1): one executable, two modes. Pure: `src/main.ts` hands the
// arguments and the platform here and runs the mode it gets back.

/** One of goop's modes, the usage, or why the arguments were refused. */
export type Command =
  | { kind: "tui" }
  | { kind: "daemon" }
  | { kind: "help" }
  | { kind: "invalid"; problem: string };

export const USAGE = [
  "Usage:",
  "  goop          Open goop; the daemon must be running",
  "  goop daemon   Run the daemon, which owns the models, the queue and the database",
  "  goop --help   Show this help",
  "",
].join("\n");

/** Reads the arguments after the executable's name. */
export function parseCommandLine(args: readonly string[]): Command {
  const [first, ...rest] = args;
  const command: Command =
    first === undefined
      ? { kind: "tui" }
      : first === "daemon"
        ? { kind: "daemon" }
        : first === "--help" || first === "-h"
          ? { kind: "help" }
          : unknown(first);
  const extra = rest[0];
  return extra === undefined || command.kind === "invalid" ? command : unknown(extra);
}

// JSON quoting escapes control characters, so an argument cannot drive the terminal.
const unknown = (argument: string): Command => ({
  kind: "invalid",
  problem: `Unknown command: ${JSON.stringify(argument)}`,
});

/** Why goop cannot run on `platform` yet, or undefined when it can. */
export function platformProblem(platform: string): string | undefined {
  return platform === "win32" ? "goop does not run on Windows yet (daemon-ipc T5)." : undefined;
}
