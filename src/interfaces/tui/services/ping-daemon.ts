// `goop`, for now (S1): connects to the running daemon, pings it and prints its answer. The screens
// come with OpenTUI (goop T25). It never starts the daemon (daemon-ipc L5) and does not know
// whether the channel is a socket or a pipe (S8): the caller opens it.
import { connectProblem, PING, type PingOutcome, pingReply } from "@/interfaces/tui/model/ping";
import { type Channel, ChannelError } from "@/shared/ipc";

/** How long `goop` waits for the daemon's answer. */
export const REPLY_TIMEOUT_MS = 5000;

/** Where the TUI writes its lines. */
export interface TuiOutput {
  print(line: string): void;
  fail(line: string): void;
}

/** Pings the daemon and returns the exit code: 0 when it answered `pong`, else 1. */
export async function pingDaemon(
  openChannel: () => Channel,
  output: TuiOutput,
  timeoutMs = REPLY_TIMEOUT_MS,
): Promise<number> {
  const { promise: settled, resolve: settle } = Promise.withResolvers<PingOutcome>();
  let connection: Awaited<ReturnType<Channel["connect"]>>;
  try {
    connection = await openChannel().connect({
      message(parsed) {
        const outcome = pingReply(parsed);
        if (outcome) settle(outcome);
      },
      close: () =>
        settle({ exitCode: 1, stderr: "goop daemon closed the connection before it answered." }),
    });
  } catch (error) {
    if (!(error instanceof ChannelError)) throw error;
    output.fail(connectProblem(error.message));
    return 1;
  }
  const timer = setTimeout(
    () => settle({ exitCode: 1, stderr: `goop daemon did not answer within ${timeoutMs} ms.` }),
    timeoutMs,
  );
  connection.send(PING);
  const outcome = await settled;
  clearTimeout(timer);
  connection.close();
  if (outcome.exitCode === 0) output.print(outcome.stdout);
  else output.fail(outcome.stderr);
  return outcome.exitCode;
}
