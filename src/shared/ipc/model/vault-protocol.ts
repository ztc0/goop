// The vault methods on the channel (daemon-ipc S4, S7). Pure, shared by both ends: the daemon
// checks the params it receives, the TUI checks the results it gets back. The params hold a
// passphrase or a recovery key, so no refusal and no error here ever holds an input.
import { z } from "zod";
import type { JsonRpcErrorObject } from "@/shared/ipc/types/json-rpc";
import type {
  VaultFailure,
  VaultMethod,
  VaultParams,
  VaultResults,
  VaultStatus,
} from "@/shared/ipc/types/vault-protocol";

/** The longest passphrase goop accepts, in characters (at most 4 KiB of UTF-8). */
export const MAX_PASSPHRASE_CHARS = 1024;
/** A recovery key is 39 characters; spaces typed in it are allowed up to this length. */
export const MAX_RECOVERY_KEY_CHARS = 128;

export const VAULT_METHODS: readonly VaultMethod[] = [
  "vault.status",
  "vault.setup",
  "vault.unlock",
  "vault.recover",
];

const VAULT_STATUSES = ["first-run", "locked", "needs-recovery", "unlocked"] as const;

export const isVaultMethod = (method: string): method is VaultMethod =>
  (VAULT_METHODS as readonly string[]).includes(method);

const passphrase = z.string().min(1).max(MAX_PASSPHRASE_CHARS);
const withPassphrase = z.strictObject({ passphrase });

const paramsSchemas: { [M in VaultMethod]: z.ZodType<VaultParams[M]> } = {
  "vault.status": z
    .strictObject({})
    .optional()
    .transform(() => ({})),
  "vault.setup": withPassphrase,
  "vault.unlock": withPassphrase,
  "vault.recover": z.strictObject({
    recoveryKey: z.string().min(1).max(MAX_RECOVERY_KEY_CHARS),
    passphrase,
  }),
};

/** The checked params, or a refusal that holds nothing of them. */
export function parseVaultParams<M extends VaultMethod>(
  method: M,
  params: unknown,
): { ok: true; params: VaultParams[M] } | { ok: false } {
  const parsed = paramsSchemas[method].safeParse(params);
  return parsed.success ? { ok: true, params: parsed.data } : { ok: false };
}

// Crockford base32 in 8 groups of 4, as `vault/keys` writes it: nothing else is ever printed.
const recoveryKey = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
const status = z.enum(VAULT_STATUSES);
const unlocked = z.strictObject({ state: z.literal("unlocked") });

const resultSchemas: { [M in VaultMethod]: z.ZodType<VaultResults[M]> } = {
  "vault.status": z.strictObject({ state: status }),
  "vault.setup": z.strictObject({ recoveryKey }),
  "vault.unlock": unlocked,
  "vault.recover": unlocked,
};

/** The daemon's result for `method`, or undefined when it is not one. */
export function readVaultResult<M extends VaultMethod>(
  method: M,
  result: unknown,
): VaultResults[M] | undefined {
  const parsed = resultSchemas[method].safeParse(result);
  return parsed.success ? parsed.data : undefined;
}

/** The vault's own errors, in the range JSON-RPC 2.0 leaves to applications. */
export const VAULT_ERRORS = {
  /** One error for every wrong passphrase or recovery key: it never says what was wrong. */
  wrongSecret: { code: 1001, message: "The passphrase or recovery key is not right." },
  keyStoreUnavailable: {
    code: 1003,
    message:
      "The OS key store is unavailable right now; try again later. The data key is not lost.",
  },
} as const satisfies Record<string, JsonRpcErrorObject>;

const WRONG_STATE_CODE = 1002;

/** The method cannot run in the vault's current state, which the error names. */
export function wrongStateError(state: VaultStatus): JsonRpcErrorObject {
  return {
    code: WRONG_STATE_CODE,
    message: `The vault is ${state}, so this cannot be done now.`,
    data: { state },
  };
}

const wrongStateData = z.strictObject({ state: status });

/** What a vault error from the daemon means; its text is never shown as it came. */
export function readVaultFailure(error: JsonRpcErrorObject): VaultFailure {
  if (error.code === VAULT_ERRORS.wrongSecret.code) return { kind: "wrong-secret" };
  if (error.code === VAULT_ERRORS.keyStoreUnavailable.code)
    return { kind: "key-store-unavailable" };
  if (error.code === WRONG_STATE_CODE) {
    const data = wrongStateData.safeParse(error.data);
    if (data.success) return { kind: "wrong-state", state: data.data.state };
  }
  return { kind: "unknown" };
}
