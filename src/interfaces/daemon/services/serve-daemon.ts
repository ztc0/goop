// `goop daemon` (S1, S3): opens the channel, answers each message until it is asked to stop, then
// closes the channel, which frees its name. It never writes a message or its params anywhere: the
// channel will carry the vault passphrase. It does not know whether the channel is a socket or a
// pipe (S8): the caller opens it.
import { answer } from "@/interfaces/daemon/model/answer";
import { type Channel, ChannelError } from "@/shared/ipc";

export const LISTENING = "goop daemon is listening.";

/** Where the daemon writes its lines. */
export interface DaemonOutput {
  print(line: string): void;
  fail(line: string): void;
}

/**
 * Serves until `stopped` settles and returns the exit code: 0 after a clean stop, 1 when the
 * channel cannot be opened (another daemon, a runtime folder that cannot be trusted).
 */
export async function serveDaemon(
  openChannel: () => Channel,
  output: DaemonOutput,
  stopped: Promise<unknown>,
): Promise<number> {
  let listener: Awaited<ReturnType<Channel["listen"]>>;
  try {
    listener = await openChannel().listen((connection) => ({
      message(parsed) {
        const reply = answer(parsed);
        if (reply) connection.send(reply);
      },
      close() {},
    }));
  } catch (error) {
    if (!(error instanceof ChannelError)) throw error;
    output.fail(error.message);
    return 1;
  }
  output.print(LISTENING);
  await stopped;
  await listener.close();
  return 0;
}
