// What the daemon answers each message with, vault methods included (daemon-ipc S4, S7). The
// vault's params hold a passphrase or a recovery key: they are checked with zod and never repeated
// in a reply, an error or a line. Everything else is `answer`'s.
import { answer } from "@/interfaces/daemon/model/answer";
import {
  VaultSecretError,
  type VaultSession,
  VaultStatusError,
} from "@/interfaces/daemon/services/vault-session";
import {
  isVaultMethod,
  JSON_RPC_ERRORS,
  type JsonRpcErrorObject,
  type JsonRpcMessage,
  type ParsedMessage,
  parseVaultParams,
  VAULT_ERRORS,
  type VaultMethod,
  wrongStateError,
} from "@/shared/ipc";
import {
  KeyStoreUnavailableError,
  NativeLibraryError,
  NativeManifestError,
  type OsEnvelopeUnavailableReason,
  StoreLibraryError,
  type VaultState,
  VaultStateError,
} from "@/shared/vault";

export const UNLOCKED_LINE = "The vault is unlocked.";
export const REFUSED_LINE = "A wrong passphrase or recovery key was refused.";

/** Writes one line the user may read; it never holds a param. */
export type Report = (line: string) => void;

/** Runs one vault method with params already checked. */
async function run(method: VaultMethod, params: unknown, vault: VaultSession): Promise<unknown> {
  const parsed = parseVaultParams(method, params);
  if (!parsed.ok) throw new InvalidParams();
  if (method === "vault.status") return { state: await vault.status() };
  const p = parsed.params as { passphrase: string; recoveryKey?: string };
  if (method === "vault.setup") return { recoveryKey: await vault.setup(p.passphrase) };
  if (method === "vault.unlock") return { state: await vault.unlock(p.passphrase) };
  return { state: await vault.recover(p.recoveryKey ?? "", p.passphrase) };
}

class InvalidParams extends Error {}

/**
 * The fixed line of each state a `VaultStateError` names. Never the error's message: only text
 * written here reaches a line, so nothing an error quotes (a manifest value, a param) can.
 */
const STATE_LINES: Readonly<Record<VaultState, string>> = {
  "first-run": "goop cannot start the vault: the vault has no data key yet; run setup first.",
  ready:
    "goop cannot start the vault: the vault already has a data key; goop never creates a new data key over existing data.",
  "needs-recovery":
    "goop cannot start the vault: the OS or passphrase envelope of the data key is missing or cannot be opened here; enter the recovery key.",
  "needs-backup":
    "goop cannot start the vault: the store exists but every envelope of its data key is missing; restore the vault folder from a backup. goop never creates a new data key over existing data.",
  "store-missing":
    "goop cannot start the vault: the envelopes of the data key exist but the store is missing; restore the store from a backup. goop changed nothing.",
};

const unavailable = (reason: OsEnvelopeUnavailableReason) =>
  `The OS key store is unavailable right now (${reason}), so goop will try again later. The data key is not lost.`;

/** The fixed line of each reason a `KeyStoreUnavailableError` names. */
const KEY_STORE_LINES: Readonly<Record<OsEnvelopeUnavailableReason, string>> = {
  "turned-off": unavailable("turned-off"),
  "unsupported-platform": unavailable("unsupported-platform"),
  "missing-tool": unavailable("missing-tool"),
  "old-version": unavailable("old-version"),
  "no-tpm2": unavailable("no-tpm2"),
  unreadable: unavailable("unreadable"),
  busy: unavailable("busy"),
};

/** The line `table` holds for `key`, only when `key` is one of its own keys. */
const lineOf = (table: Readonly<Record<string, string>>, key: unknown): string | undefined =>
  typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined;

/**
 * goop's own fixed sentence for a vault that cannot be used as it is, or undefined. Never
 * `error.message` nor `error.name`: a message may quote an outside value, such as a param.
 */
export function explanation(error: unknown): string | undefined {
  if (error instanceof VaultStateError) return lineOf(STATE_LINES, error.state);
  if (error instanceof KeyStoreUnavailableError) return lineOf(KEY_STORE_LINES, error.reason);
  return undefined;
}

/** goop's own fixed detail for a native library that cannot be used; its message quotes files. */
function libraryDetail(error: unknown): string | undefined {
  if (error instanceof NativeManifestError) {
    return "the native library manifest of this build cannot be trusted or lacks a library goop needs.";
  }
  if (error instanceof NativeLibraryError) {
    return "a native library of this build is missing or differs from the one the build pinned.";
  }
  if (error instanceof StoreLibraryError) return "the encrypted store library could not be loaded.";
  return undefined;
}

/** `what` failed, as a line: with a known error's fixed text, else nothing about the error. */
export function failureLine(what: string, error: unknown): string {
  const known = explanation(error) ?? libraryDetail(error);
  return known ? `${what}: ${known}` : `${what}.`;
}

function failure(error: unknown, method: VaultMethod, report: Report): JsonRpcErrorObject {
  if (error instanceof InvalidParams) return { ...JSON_RPC_ERRORS.invalidParams };
  if (error instanceof VaultStatusError) return wrongStateError(error.state);
  if (error instanceof VaultSecretError) {
    report(REFUSED_LINE);
    return { ...VAULT_ERRORS.wrongSecret };
  }
  if (error instanceof KeyStoreUnavailableError) return { ...VAULT_ERRORS.keyStoreUnavailable };
  report(failureLine(`goop daemon could not run ${method}`, error));
  return { ...JSON_RPC_ERRORS.internalError };
}

/** The reply to one message, or undefined when it needs none (a notification or a response). */
export async function respond(
  parsed: ParsedMessage,
  vault: VaultSession,
  report: Report,
): Promise<JsonRpcMessage | undefined> {
  if (!parsed.ok || !("method" in parsed.message) || !isVaultMethod(parsed.message.method)) {
    return answer(parsed);
  }
  const message = parsed.message;
  const method = message.method as VaultMethod;
  // A notification gets no reply, so a vault method sent as one is not run at all.
  if (!("id" in message)) return undefined;
  try {
    const result = await run(method, message.params, vault);
    if (method !== "vault.status") report(UNLOCKED_LINE);
    return { jsonrpc: "2.0", id: message.id, result };
  } catch (error) {
    return { jsonrpc: "2.0", id: message.id, error: failure(error, method, report) };
  }
}
