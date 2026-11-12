// What `goop` makes of the daemon's answer to its ping (S1). Pure: the TUI's service sends the
// ping and prints what this returns. Nothing the daemon sends is shown as it came.
import type { DaemonReply } from "@/interfaces/tui/types/daemon-reply";

/** The line to print and the exit code. */
export type PingOutcome = { exitCode: 0; stdout: string } | { exitCode: 1; stderr: string };

const failure = (stderr: string): PingOutcome => ({ exitCode: 1, stderr });

/** The outcome of the daemon's reply to the ping. */
export function pingOutcome(reply: DaemonReply): PingOutcome {
  if (reply.kind === "problem") return failure(reply.line);
  if (reply.kind === "error") return failure("goop daemon refused the ping.");
  if (reply.result === "pong") return { exitCode: 0, stdout: "goop daemon answered: pong" };
  return failure(UNEXPECTED);
}

export const UNEXPECTED = "goop daemon gave an unexpected answer.";
export const UNREADABLE = "goop daemon sent a message goop cannot read.";
export const CLOSED = "goop daemon closed the connection before it answered.";
export const tooSlow = (ms: number) => `goop daemon did not answer within ${ms} ms.`;

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
