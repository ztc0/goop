// What `goop` makes of the daemon's answer to its ping (S1). Pure: the TUI's service reads the
// channel and writes what this returns. Nothing the daemon sends is shown as it came.
import type { JsonRpcRequest, ParsedMessage } from "@/shared/ipc";

export const PING: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "ping" };

/** The line to print and the exit code. */
export type PingOutcome = { exitCode: 0; stdout: string } | { exitCode: 1; stderr: string };

const failure = (stderr: string): PingOutcome => ({ exitCode: 1, stderr });

/** The outcome of one message from the daemon, or undefined when it is not the ping's answer. */
export function pingReply(parsed: ParsedMessage): PingOutcome | undefined {
  if (!parsed.ok) return failure("goop daemon sent a message goop cannot read.");
  const message = parsed.message;
  if ("method" in message || message.id !== PING.id) return undefined;
  if ("error" in message) return failure("goop daemon refused the ping.");
  if (message.result === "pong") return { exitCode: 0, stdout: "goop daemon answered: pong" };
  return failure("goop daemon gave an unexpected answer.");
}

/** The channel's own words for "nobody listens"; the adapter throws a ChannelError with them. */
const NOT_RUNNING = "goop daemon is not running";

/**
 * What to print when the channel cannot be opened. goop never starts the daemon (daemon-ipc L5):
 * starting it belongs to the system scheduler, so it says how to start it by hand.
 */
export function connectProblem(message: string): string {
  return message === NOT_RUNNING
    ? `${NOT_RUNNING}. Start it in another terminal with: goop daemon`
    : message;
}
