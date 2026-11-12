import type { DevCommand } from "@scripts/dev/types/dev";

export const USAGE = `Usage: bun run dev [<goop arguments>]
       bun run dev:logs
       bun run dev:stop

  bun run dev        Start the dev container when it is not running (the goop daemon,
                     restarted on every source change), then run goop in it; every
                     argument goes to goop
  bun run dev:logs   Follow the goop daemon's output (Ctrl+C stops following)
  bun run dev:stop   Remove the dev container; goop's data in .temp/dev/ and the
                     packages in .local/dev/ are kept

Examples:
  bun run dev
  bun run dev --help
`;

/** argv after the script: `goop [args...]`, `logs` or `stop` (package.json adds the first word). */
export function parseCliArgs(argv: readonly string[]): DevCommand {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
      return { kind: "usage", error: "Missing command." };
    case "goop":
      return { kind: "goop", args: rest };
    case "logs":
    case "stop":
      return rest.length === 0
        ? { kind: command }
        : { kind: "usage", error: `${command} takes no arguments.` };
    default:
      return { kind: "usage", error: `Unknown command: ${command}` };
  }
}
