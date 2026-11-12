// `goop`, for now (S1, daemon-ipc S7): connects to the running daemon, opens the vault through it
// when it is locked, set up for the first time or in need of its recovery key, then pings it. The
// screens come with OpenTUI (goop T25). The passphrase and the recovery key are sent only in the
// params of their vault method and never printed; the recovery key the daemon gives is shown once.
import { type Prompt, PromptCancelledError } from "@/interfaces/tui/adapters/terminal-prompt";
import { UNEXPECTED } from "@/interfaces/tui/model/ping";
import {
  CANCELLED,
  FIRST_RUN_INTRO,
  NOT_THE_SAME,
  QUESTIONS,
  RECOVERY_INTRO,
  recoveryKeyLines,
  typedProblem,
  vaultProblem,
} from "@/interfaces/tui/model/vault-prompts";
import { connectDaemon, type DaemonClient } from "@/interfaces/tui/services/daemon-client";
import { printPing, REPLY_TIMEOUT_MS, type TuiOutput } from "@/interfaces/tui/services/ping-daemon";
import {
  type Channel,
  readVaultFailure,
  readVaultResult,
  type VaultMethod,
  type VaultParams,
  type VaultResults,
} from "@/shared/ipc";

/** A vault method derives keys (scrypt) and opens the store: it may take longer. */
export const VAULT_TIMEOUT_MS = 60_000;

export interface Timeouts {
  replyMs?: number;
  vaultMs?: number;
}

/** A step that ended the run: the line on stderr and the exit code. */
class Stop extends Error {
  constructor(
    readonly line: string,
    readonly exitCode = 1,
  ) {
    super(line);
  }
}

export async function openGoop(
  openChannel: () => Channel,
  output: TuiOutput,
  prompt: Prompt,
  timeouts: Timeouts = {},
): Promise<number> {
  const replyMs = timeouts.replyMs ?? REPLY_TIMEOUT_MS;
  const vaultMs = timeouts.vaultMs ?? VAULT_TIMEOUT_MS;
  const connected = await connectDaemon(openChannel);
  if (typeof connected === "string") {
    output.fail(connected);
    return 1;
  }
  const client: DaemonClient = connected;

  /** Sends a vault method and returns its checked result; any other outcome stops the run. */
  async function vault<M extends VaultMethod>(
    method: M,
    params: VaultParams[M] | undefined,
    timeoutMs: number,
  ): Promise<VaultResults[M]> {
    const reply = await client.request(method, params, timeoutMs);
    if (reply.kind === "problem") throw new Stop(reply.line);
    if (reply.kind === "error") throw new Stop(vaultProblem(readVaultFailure(reply.error)));
    const result = readVaultResult(method, reply.result);
    if (!result) throw new Stop(UNEXPECTED);
    return result;
  }

  /** One typed secret, checked before anything is sent. */
  async function typed(question: string, kind: "passphrase" | "recovery key"): Promise<string> {
    const answer = await prompt.ask(question);
    const problem = typedProblem(answer, kind);
    if (problem) throw new Stop(problem);
    return answer as string;
  }

  /** A new passphrase, typed twice. */
  async function newPassphrase(first: string, again: string): Promise<string> {
    const passphrase = await typed(first, "passphrase");
    if ((await typed(again, "passphrase")) !== passphrase) throw new Stop(NOT_THE_SAME);
    return passphrase;
  }

  try {
    const { state } = await vault("vault.status", undefined, replyMs);
    if (state === "locked") {
      await vault(
        "vault.unlock",
        { passphrase: await typed(QUESTIONS.passphrase, "passphrase") },
        vaultMs,
      );
    } else if (state === "first-run") {
      output.print(FIRST_RUN_INTRO);
      const passphrase = await newPassphrase(QUESTIONS.passphrase, QUESTIONS.passphraseAgain);
      const { recoveryKey } = await vault("vault.setup", { passphrase }, vaultMs);
      for (const line of recoveryKeyLines(recoveryKey)) output.print(line);
    } else if (state === "needs-recovery") {
      output.print(RECOVERY_INTRO);
      const recoveryKey = await typed(QUESTIONS.recoveryKey, "recovery key");
      const passphrase = await newPassphrase(QUESTIONS.newPassphrase, QUESTIONS.newPassphraseAgain);
      await vault("vault.recover", { recoveryKey, passphrase }, vaultMs);
    }
    return await printPing(client, output, replyMs);
  } catch (error) {
    if (error instanceof PromptCancelledError) {
      output.fail(CANCELLED);
      return 130;
    }
    if (!(error instanceof Stop)) throw error;
    output.fail(error.line);
    return error.exitCode;
  } finally {
    client.close();
  }
}
