// Doubles for the daemon's vault tests: the vault folder in memory, envelopes that open only with
// the secret that sealed them, an OS key store bound to one machine, and a store engine whose
// "file" is the key it was created with. The key service itself is the real one.
import {
  type EncryptedStore,
  type EncryptedStoreEngine,
  EnvelopeOpenError,
  KeyInputError,
  type OsEnvelopeAvailability,
  OsEnvelopeOpenError,
  type OsKeyEnvelope,
  StoreOpenError,
  VaultFileError,
  type VaultFileName,
  type VaultFiles,
  type VaultKeys,
} from "@/shared/vault";

export const RECOVERY_KEY = "0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ";
export const PASSPHRASE = "passphrase-SECRET-0001";
export const WRONG = "wrong-SECRET-0002";
/** Every secret the tests use: none may appear in a reply, a line or an error. */
export const SECRETS = [RECOVERY_KEY, PASSPHRASE, WRONG, "SECRET"];

export const NO_TPM2: OsEnvelopeAvailability = {
  available: false,
  reason: "no-tpm2",
  message: "This machine has no TPM2.",
};

const encode = (text: string) => new TextEncoder().encode(text);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const concat = (a: Uint8Array, b: Uint8Array) => new Uint8Array([...a, ...b]);
const sealedBy = (bytes: Uint8Array, prefix: Uint8Array) =>
  bytes.length === prefix.length + 32 && prefix.every((byte, index) => bytes[index] === byte);

export function fakeVault(availability: OsEnvelopeAvailability = NO_TPM2) {
  const data = new Map<VaultFileName, Uint8Array>();
  const os = { machine: "machine-a", availability };
  const counts = { engines: 0 };
  const opened: { closed: boolean }[] = [];

  const files: VaultFiles = {
    path: (name) => `/vault/${name}`,
    exists: async (name) => data.has(name),
    read: async (name) => {
      const bytes = data.get(name);
      return bytes && new Uint8Array(bytes);
    },
    async write(name, bytes, { replace }) {
      if (!replace && data.has(name)) throw new VaultFileError(name, "already exists");
      data.set(name, new Uint8Array(bytes));
    },
    remove: async (name) => {
      data.delete(name);
    },
  };

  const seal = (kind: string, secret: string, dek: Uint8Array) =>
    Promise.resolve(concat(encode(`${kind}:${secret}:`), dek));
  const open = async (kind: string, envelope: Uint8Array, secret: string) => {
    if (secret.length < 8) throw new KeyInputError(`"${secret}" is too short`);
    const prefix = encode(`${kind}:${secret}:`);
    if (!sealedBy(envelope, prefix)) throw new EnvelopeOpenError();
    return envelope.slice(prefix.length);
  };
  const keys: VaultKeys = {
    newDataKey: () => new Uint8Array(32).fill(7),
    newRecoveryKey: () => RECOVERY_KEY,
    sealWithRecoveryKey: (dek, key) => seal("recovery", key, dek),
    sealWithPassphrase: (dek, passphrase) => seal("passphrase", passphrase, dek),
    openRecoveryEnvelope: (envelope, key) => open("recovery", envelope, key),
    openPassphraseEnvelope: (envelope, passphrase) => open("passphrase", envelope, passphrase),
  };

  const osEnvelope: OsKeyEnvelope = {
    availability: async () => os.availability,
    seal: async (dek) => concat(encode(`os:${os.machine}:`), dek),
    async open(sealed) {
      const prefix = encode(`os:${os.machine}:`);
      if (!sealedBy(sealed, prefix)) throw new OsEnvelopeOpenError();
      return sealed.slice(prefix.length);
    },
  };

  const engine: EncryptedStoreEngine = {
    open(path, key) {
      const name = path.replace("/vault/", "") as VaultFileName;
      const existing = data.get(name);
      if (existing?.length && hex(existing) !== hex(key)) throw new StoreOpenError();
      if (!existing?.length) data.set(name, new Uint8Array(key));
      const record = { closed: false };
      opened.push(record);
      const store: EncryptedStore = {
        run: () => {},
        query: () => [],
        transaction: (work) => work(),
        close: () => {
          record.closed = true;
        },
      };
      return store;
    },
  };

  /** The engine as goop gets it: resolved again (the library hash-checked) before each open. */
  const loadEngine = async () => {
    counts.engines++;
    return engine;
  };

  return { data, os, counts, opened, files, keys, osEnvelope, loadEngine };
}

export type FakeVault = ReturnType<typeof fakeVault>;
