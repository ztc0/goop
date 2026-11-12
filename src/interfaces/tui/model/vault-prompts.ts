// What `goop` asks and says while it opens the vault through the daemon (daemon-ipc S7). Pure:
// nothing here ever holds what the user typed, and nothing the daemon wrote is shown as it came.
import { MAX_PASSPHRASE_CHARS, MAX_RECOVERY_KEY_CHARS, type VaultFailure } from "@/shared/ipc";

export const QUESTIONS = {
  passphrase: "Passphrase: ",
  passphraseAgain: "Passphrase again: ",
  newPassphrase: "New passphrase: ",
  newPassphraseAgain: "New passphrase again: ",
  recoveryKey: "Recovery key: ",
} as const;

export const FIRST_RUN_INTRO = "goop has no vault yet. Choose a passphrase to protect it.";
export const RECOVERY_INTRO =
  "The vault's usual key cannot open it here. Type the recovery key you wrote down, then choose a new passphrase.";

/** The recovery key, shown once, with what to do with it. */
export const recoveryKeyLines = (recoveryKey: string) => [
  "Your recovery key:",
  `    ${recoveryKey}`,
  "Write it down now and keep it somewhere safe: goop shows it only this once, and it is the only way back in if the passphrase is lost.",
];

export const CANCELLED = "Cancelled.";
const UNCHANGED = "Nothing was changed.";

/** Why a typed passphrase or recovery key is not sent, or undefined when it may be. */
export function typedProblem(
  typed: string | undefined,
  kind: "passphrase" | "recovery key",
): string | undefined {
  if (typed === undefined || typed === "") return `Nothing was typed. ${UNCHANGED}`;
  const limit = kind === "passphrase" ? MAX_PASSPHRASE_CHARS : MAX_RECOVERY_KEY_CHARS;
  if (typed.length > limit) {
    return `The ${kind} is longer than ${limit} characters. ${UNCHANGED}`;
  }
  return undefined;
}

export const NOT_THE_SAME = `The two passphrases are not the same. ${UNCHANGED}`;

/** What a vault error means to the user, in goop's own words. */
export function vaultProblem(failure: VaultFailure): string {
  switch (failure.kind) {
    case "wrong-secret":
      return `The passphrase or recovery key is not right. ${UNCHANGED}`;
    case "wrong-state":
      return `The vault is ${failure.state} now. Run goop again.`;
    case "key-store-unavailable":
      return "The OS key store is unavailable right now; try again later. The data key is not lost.";
    default:
      return "goop daemon could not do it; its own output says why.";
  }
}
