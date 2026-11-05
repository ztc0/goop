// The key service (S9, ADR 0002): setup creates the data key and its envelopes, start opens the
// OS or passphrase envelope, recovery opens the recovery envelope and writes a new OS or passphrase
// envelope. Only setup creates a data key, and only in an empty vault folder (L32).
import {
  type Bytes,
  type DataKey,
  newDataKey,
  newRecoveryKey,
  openPassphraseEnvelope,
  openRecoveryEnvelope,
  sealWithPassphrase,
  sealWithRecoveryKey,
} from "@/shared/vault/keys";
import {
  type OsEnvelopeAvailability,
  OsEnvelopeOpenError,
  OsEnvelopeUnavailableError,
  type OsKeyEnvelope,
} from "@/shared/vault/keystore";
import type { EncryptedStore, EncryptedStoreEngine } from "@/shared/vault/storage";
import {
  KeyStoreUnavailableError,
  OS_ENVELOPE_FILE,
  PASSPHRASE_ENVELOPE_FILE,
  PassphraseRequiredError,
  RECOVERY_ENVELOPE_FILE,
  STORE_FILE,
  VaultFileError,
  VaultStateError,
  vaultState,
} from "../model/vault-state";
import type { VaultFileName, VaultFiles, VaultKeys, VaultState } from "../types/vault";

/**
 * goop's SQLite application id ("goop"). Setup writes it so the new store has an encrypted first
 * page at once: an empty file would open with any key, and could not prove one.
 */
const APPLICATION_ID = 0x676f6f70;

const randomKeys: VaultKeys = {
  newDataKey,
  newRecoveryKey,
  sealWithRecoveryKey,
  sealWithPassphrase,
  openRecoveryEnvelope,
  openPassphraseEnvelope,
};

export interface KeyServiceOptions {
  files: VaultFiles;
  os: OsKeyEnvelope;
  engine: EncryptedStoreEngine;
  /** The real envelopes by default; tests pass fakes. */
  keys?: VaultKeys;
  /** Asks the user for the passphrase when start needs the passphrase envelope. */
  askPassphrase?: () => Promise<string>;
}

export interface SetupResult {
  /** Shown to the user once. goop never stores or logs it. */
  recoveryKey: string;
  store: EncryptedStore;
}

export type KeyService = ReturnType<typeof keyService>;

export function keyService(options: KeyServiceOptions) {
  const { files, os, engine } = options;
  const keys = options.keys ?? randomKeys;

  async function state(): Promise<VaultState> {
    const [store, osEnvelope, passphraseEnvelope, recoveryEnvelope] = await Promise.all(
      [STORE_FILE, OS_ENVELOPE_FILE, PASSPHRASE_ENVELOPE_FILE, RECOVERY_ENVELOPE_FILE].map((name) =>
        files.exists(name),
      ),
    );
    return vaultState({
      store: store === true,
      osEnvelope: osEnvelope === true,
      passphraseEnvelope: passphraseEnvelope === true,
      recoveryEnvelope: recoveryEnvelope === true,
    });
  }

  /** A busy key store means try again later, never a switch to the passphrase. */
  async function osAvailability(): Promise<OsEnvelopeAvailability> {
    const availability = await os.availability();
    if (!availability.available && availability.reason === "busy") {
      throw new KeyStoreUnavailableError("busy");
    }
    return availability;
  }

  /** Refused before any key is made or opened: without the OS key store, a passphrase seals. */
  function checkSealable(availability: OsEnvelopeAvailability, passphrase: string | undefined) {
    if (!availability.available && !passphrase) {
      throw new PassphraseRequiredError(
        `the OS key store cannot be used here (${availability.reason})`,
      );
    }
  }

  /** The data key sealed by the OS key store, or by the passphrase where it cannot be used (S4). */
  async function primaryEnvelope(
    dek: DataKey,
    availability: OsEnvelopeAvailability,
    passphrase: string | undefined,
  ): Promise<[VaultFileName, Bytes]> {
    checkSealable(availability, passphrase);
    if (!availability.available) {
      return [PASSPHRASE_ENVELOPE_FILE, await keys.sealWithPassphrase(dek, passphrase ?? "")];
    }
    try {
      return [OS_ENVELOPE_FILE, await os.seal(dek)];
    } catch (error) {
      if (error instanceof OsEnvelopeUnavailableError) {
        throw new KeyStoreUnavailableError(error.reason);
      }
      throw error;
    }
  }

  /** The data key from the OS envelope, else from the passphrase envelope. */
  async function openDataKey(): Promise<DataKey> {
    let osProblem: Error | undefined;
    const sealed = await files.read(OS_ENVELOPE_FILE);
    if (sealed) {
      try {
        const availability = await os.availability();
        if (!availability.available) throw new OsEnvelopeUnavailableError(availability);
        return await os.open(sealed);
      } catch (error) {
        // Another TPM or user cannot open it: only the recovery key helps, never a new key.
        if (error instanceof OsEnvelopeOpenError) {
          osProblem = new VaultStateError("needs-recovery", "start");
        } else if (error instanceof OsEnvelopeUnavailableError) {
          osProblem = new KeyStoreUnavailableError(error.reason);
        } else {
          throw error;
        }
      }
    }
    const envelope = await files.read(PASSPHRASE_ENVELOPE_FILE);
    if (!envelope) throw osProblem ?? new VaultStateError("needs-recovery", "start");
    if (!options.askPassphrase) {
      throw new PassphraseRequiredError(
        "the data key is sealed with a passphrase and no prompt was given",
      );
    }
    return keys.openPassphraseEnvelope(envelope, await options.askPassphrase());
  }

  return {
    state,

    /** Creates the data key, its envelopes and the store. Only in an empty vault folder. */
    async setup({ passphrase }: { passphrase?: string } = {}): Promise<SetupResult> {
      const current = await state();
      if (current !== "first-run") throw new VaultStateError(current, "set up");
      const availability = await osAvailability();
      checkSealable(availability, passphrase);

      const dek = keys.newDataKey();
      try {
        const recoveryKey = keys.newRecoveryKey();
        const envelopes: [VaultFileName, Bytes][] = [
          await primaryEnvelope(dek, availability, passphrase),
          [RECOVERY_ENVELOPE_FILE, await keys.sealWithRecoveryKey(dek, recoveryKey)],
        ];
        const created: VaultFileName[] = [];
        try {
          for (const [name, bytes] of envelopes) {
            await files.write(name, bytes, { replace: false });
            created.push(name);
          }
          // Claim the store file before opening it: an empty file, created only if none exists. A
          // store restored meanwhile makes this fail, so it is never opened nor removed here.
          await files.write(STORE_FILE, new Uint8Array(0), { replace: false });
          created.push(STORE_FILE);
          const store = engine.open(files.path(STORE_FILE), dek);
          try {
            store.run(`PRAGMA application_id = ${APPLICATION_ID}`);
          } catch (error) {
            store.close();
            throw error;
          }
          return { recoveryKey, store };
        } catch (error) {
          // Only what this setup wrote: a file that was already there is never touched.
          for (const name of created) await files.remove(name).catch(() => {});
          throw error;
        }
      } finally {
        dek.fill(0);
      }
    },

    /** Opens the data key and the store. */
    async start(): Promise<EncryptedStore> {
      const current = await state();
      if (current !== "ready") throw new VaultStateError(current, "start");
      const dek = await openDataKey();
      try {
        return engine.open(files.path(STORE_FILE), dek);
      } finally {
        // The store keeps its own derived key; this copy is no longer needed.
        dek.fill(0);
      }
    },

    /**
     * Opens the recovery envelope and writes a new OS envelope, or a passphrase envelope where
     * the OS key store cannot be used. The data key stays the same.
     */
    async recover(recoveryKey: string, passphrase?: string): Promise<EncryptedStore> {
      const current = await state();
      if (current !== "ready" && current !== "needs-recovery") {
        throw new VaultStateError(current, "recover");
      }
      const envelope = await files.read(RECOVERY_ENVELOPE_FILE);
      if (!envelope) throw new VaultFileError(RECOVERY_ENVELOPE_FILE, "is missing");
      const availability = await osAvailability();
      checkSealable(availability, passphrase);

      const dek = await keys.openRecoveryEnvelope(envelope, recoveryKey);
      try {
        // Fail fast: a data key that does not open the store never replaces an envelope.
        const store = engine.open(files.path(STORE_FILE), dek);
        try {
          const [name, bytes] = await primaryEnvelope(dek, availability, passphrase);
          await files.write(name, bytes, { replace: true });
          return store;
        } catch (error) {
          store.close();
          throw error;
        }
      } finally {
        dek.fill(0);
      }
    },
  };
}
