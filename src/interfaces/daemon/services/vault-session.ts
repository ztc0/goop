// The daemon's vault (daemon-ipc S3, S7, L8): the daemon owns it, so only it opens the store. At
// start it opens the vault without a passphrase: a working OS key store unlocks it by itself;
// a vault sealed with a passphrase stays locked and the daemon holds no store until `goop` sends
// the passphrase. The passphrase and the recovery key are never kept, logged or put in an error.
import type { VaultStatus } from "@/shared/ipc";
import {
  type EncryptedStore,
  type EncryptedStoreEngine,
  EnvelopeOpenError,
  KeyInputError,
  type KeyService,
  keyService,
  type OsKeyEnvelope,
  PassphraseRequiredError,
  type VaultFiles,
  type VaultKeys,
  VaultStateError,
} from "@/shared/vault";

/** A wrong passphrase or recovery key. One fixed message: it never says what was wrong. */
export class VaultSecretError extends Error {
  override name = "VaultSecretError";
  constructor() {
    super("The passphrase or recovery key is not right.");
  }
}

/** The vault's state does not allow this now; `state` says what it allows. */
export class VaultStatusError extends Error {
  override name = "VaultStatusError";
  readonly state: VaultStatus;
  constructor(state: VaultStatus) {
    super(`The vault is ${state}, so this cannot be done now.`);
    this.state = state;
  }
}

export interface VaultSessionOptions {
  files: VaultFiles;
  os: OsKeyEnvelope;
  /**
   * The store engine, loaded again before each open: the native library is hash-checked every
   * time (vault/native S4), and only when a store is about to open.
   */
  loadEngine: () => Promise<EncryptedStoreEngine>;
  /** The real envelopes by default; tests pass fakes. */
  keys?: VaultKeys;
}

export type VaultSession = ReturnType<typeof vaultSession>;

/** A typed secret that does not open its envelope, said in one way only. */
function secretError(error: unknown): unknown {
  return error instanceof EnvelopeOpenError || error instanceof KeyInputError
    ? new VaultSecretError()
    : error;
}

export function vaultSession(options: VaultSessionOptions) {
  let status: VaultStatus = "first-run";
  let store: EncryptedStore | undefined;
  // One vault operation at a time: two unlocks never race over the same files.
  let queue: Promise<unknown> = Promise.resolve();

  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  }

  async function service(askPassphrase?: () => Promise<string>): Promise<KeyService> {
    return keyService({
      files: options.files,
      os: options.os,
      engine: await options.loadEngine(),
      ...(options.keys && { keys: options.keys }),
      ...(askPassphrase && { askPassphrase }),
    });
  }

  /** Fails unless the vault is in `allowed`. */
  function require(allowed: VaultStatus) {
    if (status !== allowed) throw new VaultStatusError(status);
  }

  function unlocked(opened: EncryptedStore): "unlocked" {
    store = opened;
    status = "unlocked";
    return status;
  }

  return {
    /**
     * Reads the vault folder and opens it without a passphrase. Rejects with `VaultStateError`
     * when only a backup can help, and with `KeyStoreUnavailableError` when the OS key store must
     * be tried again later: neither is ever a switch to the passphrase.
     */
    open: () =>
      serial(async (): Promise<VaultStatus> => {
        // The state needs no engine: the native library loads only when a store opens.
        const current = await keyService({
          files: options.files,
          os: options.os,
          engine: {
            open() {
              throw new Error("reading the vault state opens no store");
            },
          },
        }).state();
        if (current === "first-run" || current === "needs-recovery") {
          status = current;
          return status;
        }
        if (current !== "ready") throw new VaultStateError(current, "start");
        try {
          return unlocked(await (await service()).start());
        } catch (error) {
          if (error instanceof PassphraseRequiredError) status = "locked";
          else if (error instanceof VaultStateError && error.state === "needs-recovery") {
            status = "needs-recovery";
          } else throw error;
          return status;
        }
      }),

    status: () => serial(async () => status),

    /** The open store, only once the vault is unlocked (L8). */
    store: () => store,

    /** Creates the vault; the recovery key is returned once and never kept here. */
    setup: (passphrase: string) =>
      serial(async () => {
        require("first-run");
        const result = await (await service()).setup({ passphrase });
        unlocked(result.store);
        return result.recoveryKey;
      }),

    unlock: (passphrase: string) =>
      serial(async () => {
        require("locked");
        try {
          return unlocked(await (await service(async () => passphrase)).start());
        } catch (error) {
          throw secretError(error);
        }
      }),

    /** Opens the recovery envelope and seals the data key again, with `passphrase` if needed. */
    recover: (recoveryKey: string, passphrase: string) =>
      serial(async () => {
        require("needs-recovery");
        try {
          return unlocked(await (await service()).recover(recoveryKey, passphrase));
        } catch (error) {
          throw secretError(error);
        }
      }),

    close() {
      store?.close();
      store = undefined;
    },
  };
}
