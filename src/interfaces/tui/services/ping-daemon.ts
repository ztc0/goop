// The ping (S1): asks the daemon for `pong` and prints its answer. `goop` pings once the vault is
// open (`open-goop`). It never starts the daemon (daemon-ipc L5) and does not know whether the
// channel is a socket or a pipe (S8): the caller opens it.
import { pingOutcome } from "@/interfaces/tui/model/ping";
import { connectDaemon, type DaemonClient } from "@/interfaces/tui/services/daemon-client";
import type { Channel } from "@/shared/ipc";

/** How long `goop` waits for the daemon's answer to a ping or a status. */
export const REPLY_TIMEOUT_MS = 5000;

/** Where the TUI writes its lines. */
export interface TuiOutput {
  print(line: string): void;
  fail(line: string): void;
}

/** Pings over an open connection, prints the answer and returns 0 for `pong`, else 1. */
export async function printPing(
  client: DaemonClient,
  output: TuiOutput,
  timeoutMs = REPLY_TIMEOUT_MS,
): Promise<number> {
  const outcome = pingOutcome(await client.request("ping", undefined, timeoutMs));
  if (outcome.exitCode === 0) output.print(outcome.stdout);
  else output.fail(outcome.stderr);
  return outcome.exitCode;
}

/** Connects, pings the daemon and returns the exit code: 0 when it answered `pong`, else 1. */
export async function pingDaemon(
  openChannel: () => Channel,
  output: TuiOutput,
  timeoutMs = REPLY_TIMEOUT_MS,
): Promise<number> {
  const client = await connectDaemon(openChannel);
  if (typeof client === "string") {
    output.fail(client);
    return 1;
  }
  try {
    return await printPing(client, output, timeoutMs);
  } finally {
    client.close();
  }
}
