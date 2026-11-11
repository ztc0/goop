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
  StoreLibraryError,
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

/** Errors whose fixed text says what to do and never holds a secret. */
const EXPLAINED = [
  VaultStateError,
  KeyStoreUnavailableError,
  NativeLibraryError,
  NativeManifestError,
  StoreLibraryError,
];

/** The fixed text of a known error, or undefined for any other, whose message might hold anything. */
export const explanation = (error: unknown): string | undefined =>
  EXPLAINED.some((type) => error instanceof type) ? (error as Error).message : undefined;

/** `what` failed, as a line: with the known error's text, else with only the error's kind. */
export function failureLine(what: string, error: unknown): string {
  const known = explanation(error);
  if (known) return `${what}: ${known}`;
  const name = error instanceof Error ? error.name : "";
  return `${what} (${/^\w{1,64}$/.test(name) ? name : "Error"}).`;
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
