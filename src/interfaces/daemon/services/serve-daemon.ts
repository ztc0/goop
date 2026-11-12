// `goop daemon` (S1, S3): opens the channel, then the vault it owns, answers each message until it
// is asked to stop, then closes the store and the channel, which frees its name. A locked vault
// waits for `goop` to send the passphrase (L8). It never writes a message or its params anywhere:
// the channel carries the vault passphrase. It does not know whether the channel is a socket or a
// pipe (S8): the caller opens it.
import { explanation, failureLine, respond } from "@/interfaces/daemon/services/respond";
import type { VaultSession } from "@/interfaces/daemon/services/vault-session";
import { type Channel, ChannelError, type VaultStatus } from "@/shared/ipc";

export const LISTENING = "goop daemon is listening.";

/** What the daemon says about the vault once it opened it; never a secret. */
export const VAULT_LINES: Record<VaultStatus, string> = {
  unlocked: "The vault is unlocked.",
  locked: "The vault is locked. Unlock it with: goop",
  "first-run": "The vault is not set up yet. Set it up with: goop",
  "needs-recovery": "The vault needs its recovery key. Enter it with: goop",
};

/** Where the daemon writes its lines. */
export interface DaemonOutput {
  print(line: string): void;
  fail(line: string): void;
}

/**
 * Serves until `stopped` settles and returns the exit code: 0 after a clean stop, 1 when the
 * channel cannot be opened (another daemon, a runtime folder that cannot be trusted) or the vault
 * cannot be opened now (only a backup helps, or the OS key store must be tried again later).
 */
export async function serveDaemon(
  openChannel: () => Channel,
  output: DaemonOutput,
  stopped: Promise<unknown>,
  vault: VaultSession,
): Promise<number> {
  let listener: Awaited<ReturnType<Channel["listen"]>>;
  try {
    listener = await openChannel().listen((connection) => ({
      message(parsed) {
        void respond(parsed, vault, output.print).then((reply) => {
          if (reply) connection.send(reply);
        });
      },
      close() {},
    }));
  } catch (error) {
    if (!(error instanceof ChannelError)) throw error;
    output.fail(error.message);
    return 1;
  }
  // The channel first: a second daemon is refused before it reads the vault.
  let status: VaultStatus;
  try {
    status = await vault.open();
  } catch (error) {
    await listener.close();
    output.fail(explanation(error) ?? failureLine("goop daemon could not open the vault", error));
    return 1;
  }
  output.print(LISTENING);
  output.print(VAULT_LINES[status]);
  await stopped;
  await listener.close();
  vault.close();
  return 0;
}
