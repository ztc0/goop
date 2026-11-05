import { describe, expect, test } from "bun:test";
import {
  type EncryptedStore,
  type EncryptedStoreEngine,
  EnvelopeOpenError,
  KeyStoreUnavailableError,
  keyService,
  type OsEnvelopeAvailability,
  OsEnvelopeOpenError,
  OsEnvelopeUnavailableError,
  type OsKeyEnvelope,
  PassphraseRequiredError,
  StoreError,
  StoreOpenError,
  VaultFileError,
  type VaultFileName,
  type VaultFiles,
  type VaultKeys,
  type VaultState,
  VaultStateError,
} from "@/shared/vault";

const STORE: VaultFileName = "goop.db";
const OS: VaultFileName = "data-key.os";
const PASSPHRASE: VaultFileName = "data-key.passphrase";
const RECOVERY: VaultFileName = "data-key.recovery";

const RECOVERY_KEY = "RKEY-SECRET-0001";
const USER_PASSPHRASE = "passphrase-SECRET-0001";
const DEK_BYTE = 7;
const NO_TPM2: OsEnvelopeAvailability = {
  available: false,
  reason: "no-tpm2",
  message: "This machine has no TPM2.",
};
const BUSY = {
  available: false,
  reason: "busy",
  message: "The key store is busy.",
} as const;

const encode = (text: string) => new TextEncoder().encode(text);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const join = (a: Uint8Array, b: Uint8Array) => new Uint8Array([...a, ...b]);
const startsWith = (bytes: Uint8Array, prefix: Uint8Array) =>
  bytes.length === prefix.length + 32 && prefix.every((byte, index) => bytes[index] === byte);

/** Seals by prefixing the secret, opens only with the same secret: enough to see who opened what. */
function fakeKeys() {
  let newKeys = 0;
  const seal = (kind: string, secret: string, dek: Uint8Array) =>
    Promise.resolve(join(encode(`${kind}:${secret}:`), dek));
  const open = async (kind: string, envelope: Uint8Array, secret: string) => {
    const prefix = encode(`${kind}:${secret}:`);
    if (!startsWith(envelope, prefix)) throw new EnvelopeOpenError();
    return envelope.slice(prefix.length);
  };
  const keys: VaultKeys = {
    newDataKey: () => {
      newKeys++;
      return new Uint8Array(32).fill(DEK_BYTE);
    },
    newRecoveryKey: () => RECOVERY_KEY,
    sealWithRecoveryKey: (dek, key) => seal("recovery", key, dek),
    sealWithPassphrase: (dek, passphrase) => seal("passphrase", passphrase, dek),
    openRecoveryEnvelope: (envelope, key) => open("recovery", envelope, key),
    openPassphraseEnvelope: (envelope, passphrase) => open("passphrase", envelope, passphrase),
  };
  return {
    keys,
    newKeys: () => newKeys,
    reset: () => {
      newKeys = 0;
    },
  };
}

/** An OS key store bound to `machine`: a blob sealed on another machine does not open. */
function fakeOs(machine = "machine-a") {
  const state = {
    machine,
    availability: { available: true } as OsEnvelopeAvailability,
    busyOnOpen: false,
    busyOnSeal: false,
    sealFails: false,
  };
  const os: OsKeyEnvelope = {
    availability: async () => state.availability,
    async seal(dek) {
      if (state.busyOnSeal) throw new OsEnvelopeUnavailableError(BUSY);
      if (state.sealFails) throw new Error("seal failed");
      return join(encode(`os:${state.machine}:`), dek);
    },
    async open(sealed) {
      if (state.busyOnOpen) throw new OsEnvelopeUnavailableError(BUSY);
      const prefix = encode(`os:${state.machine}:`);
      if (!startsWith(sealed, prefix)) throw new OsEnvelopeOpenError();
      return sealed.slice(prefix.length);
    },
  };
  return { os, state };
}

/** The vault folder in memory, plus a store engine whose "file" is the key it was created with. */
function fakeVault() {
  const data = new Map<VaultFileName, Uint8Array>();
  const failWrite = new Set<VaultFileName>();
  const hooks = { beforeWrite: (_name: VaultFileName) => {}, openFails: false };
  const files: VaultFiles = {
    path: (name) => `/vault/${name}`,
    exists: async (name) => data.has(name),
    read: async (name) => {
      const bytes = data.get(name);
      return bytes && new Uint8Array(bytes);
    },
    async write(name, bytes, { replace }) {
      hooks.beforeWrite(name);
      if (failWrite.has(name)) throw new Error(`disk full while writing ${name}`);
      if (!replace && data.has(name)) throw new VaultFileError(name, "already exists");
      data.set(name, new Uint8Array(bytes));
    },
    remove: async (name) => {
      data.delete(name);
    },
  };

  const givenKeys: Uint8Array[] = [];
  const opened: { key: string; closed: boolean }[] = [];
  const engine: EncryptedStoreEngine = {
    open(path, key) {
      givenKeys.push(key);
      const name = path.replace("/vault/", "") as VaultFileName;
      const existing = data.get(name);
      if (hooks.openFails) {
        data.set(name, new Uint8Array(0));
        throw new StoreError("open", "io-error");
      }
      if (existing && hex(existing) !== hex(key)) throw new StoreOpenError();
      if (!existing) data.set(name, new Uint8Array(key));
      const record = { key: hex(key), closed: false };
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
  const snapshot = () => Object.fromEntries([...data].map(([name, bytes]) => [name, hex(bytes)]));
  return { data, failWrite, hooks, files, engine, givenKeys, opened, snapshot };
}

const DEK_HEX = hex(new Uint8Array(32).fill(DEK_BYTE));

function harness(options: { askPassphrase?: () => Promise<string> } = {}) {
  const vault = fakeVault();
  const keys = fakeKeys();
  const os = fakeOs();
  const service = () =>
    keyService({
      files: vault.files,
      os: os.os,
      engine: vault.engine,
      keys: keys.keys,
      ...options,
    });
  return { vault, keys, os, service };
}

/** The rejection of `promise`; its message never holds a key, a passphrase or a recovery key. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    const message = (error as Error).message;
    for (const secret of [RECOVERY_KEY, USER_PASSPHRASE, DEK_HEX, "SECRET"]) {
      expect(message).not.toContain(secret);
    }
    return error as Error;
  }
  throw new Error("expected a rejection");
}

const ask = (passphrase: string) => async () => passphrase;

/** Puts the folder in `state` with a real setup, then removes files. */
async function arrange(h: ReturnType<typeof harness>, state: VaultState) {
  if (state === "first-run") return;
  await h.service().setup({});
  h.keys.reset();
  if (state === "needs-recovery") h.vault.data.delete(OS);
  if (state === "needs-backup") {
    h.vault.data.delete(OS);
    h.vault.data.delete(RECOVERY);
  }
  if (state === "store-missing") h.vault.data.delete(STORE);
}

describe("state", () => {
  test("reads the vault folder", async () => {
    const h = harness();
    expect(await h.service().state()).toBe("first-run");
    await h.service().setup({});
    expect(await h.service().state()).toBe("ready");
  });
});

describe("setup", () => {
  test("with the OS key store: OS and recovery envelopes, the store, the recovery key once", async () => {
    const h = harness();

    const { recoveryKey, store } = await h.service().setup({ passphrase: USER_PASSPHRASE });

    expect(recoveryKey).toBe(RECOVERY_KEY);
    expect(store).toBeDefined();
    expect([...h.vault.data.keys()].sort()).toEqual([OS, RECOVERY, STORE].sort());
    expect(hex(h.vault.data.get(OS) ?? new Uint8Array())).toBe(
      hex(join(encode("os:machine-a:"), new Uint8Array(32).fill(DEK_BYTE))),
    );
    expect(hex(h.vault.data.get(RECOVERY) ?? new Uint8Array())).toBe(
      hex(join(encode(`recovery:${RECOVERY_KEY}:`), new Uint8Array(32).fill(DEK_BYTE))),
    );
    expect(h.vault.opened).toEqual([{ key: DEK_HEX, closed: false }]);
    expect(h.keys.newKeys()).toBe(1);
  });

  test("zeroes the data key once the store has it", async () => {
    const h = harness();
    await h.service().setup({});
    expect(h.vault.givenKeys.map(hex)).toEqual([hex(new Uint8Array(32))]);
  });

  test("without the OS key store: a passphrase envelope instead of the OS one", async () => {
    const h = harness();
    h.os.state.availability = NO_TPM2;

    await h.service().setup({ passphrase: USER_PASSPHRASE });

    expect([...h.vault.data.keys()].sort()).toEqual([PASSPHRASE, RECOVERY, STORE].sort());
    expect(hex(h.vault.data.get(PASSPHRASE) ?? new Uint8Array())).toBe(
      hex(join(encode(`passphrase:${USER_PASSPHRASE}:`), new Uint8Array(32).fill(DEK_BYTE))),
    );
  });

  test("without the OS key store and without a passphrase: refused, nothing written", async () => {
    const h = harness();
    h.os.state.availability = NO_TPM2;

    const error = await rejection(h.service().setup({}));

    expect(error).toBeInstanceOf(PassphraseRequiredError);
    expect(error.message).toBe(
      "A passphrase is needed: the OS key store cannot be used here (no-tpm2).",
    );
    expect(h.vault.data.size).toBe(0);
    expect(h.keys.newKeys()).toBe(0);
  });

  test("a busy OS key store: try again, nothing written", async () => {
    const h = harness();
    h.os.state.availability = BUSY;

    const error = await rejection(h.service().setup({ passphrase: USER_PASSPHRASE }));

    expect(error).toBeInstanceOf(KeyStoreUnavailableError);
    expect(error.message).toBe(
      "The OS key store is unavailable right now (busy), so goop will try again later. The data key is not lost.",
    );
    expect(h.vault.data.size).toBe(0);
  });

  test.each(["ready", "needs-recovery", "needs-backup", "store-missing"] as const)(
    "refused in %p: no new data key, every file unchanged",
    async (state) => {
      const h = harness();
      await arrange(h, state);
      const before = h.vault.snapshot();

      const error = await rejection(h.service().setup({ passphrase: USER_PASSPHRASE }));

      expect(error).toBeInstanceOf(VaultStateError);
      expect((error as VaultStateError).state).toBe(state);
      expect(error.message).toStartWith("goop cannot set up the vault: ");
      expect(h.vault.snapshot()).toEqual(before);
      expect(h.keys.newKeys()).toBe(0);
    },
  );

  test("refused when only the store exists", async () => {
    const h = harness();
    h.vault.data.set(STORE, new Uint8Array([1]));

    const error = await rejection(h.service().setup({}));

    expect(error.message).toBe(
      "goop cannot set up the vault: the store exists but every envelope of its data key is missing; restore the vault folder from a backup. goop never creates a new data key over existing data.",
    );
    expect(h.vault.snapshot()).toEqual({ [STORE]: "01" });
  });

  test("a failed OS seal writes nothing", async () => {
    const h = harness();
    h.os.state.sealFails = true;

    await rejection(h.service().setup({}));

    expect(h.vault.data.size).toBe(0);
  });

  test("a failed recovery envelope write removes the OS envelope it wrote", async () => {
    const h = harness();
    h.vault.failWrite.add(RECOVERY);

    const error = await rejection(h.service().setup({}));

    expect(error.message).toBe("disk full while writing data-key.recovery");
    expect(h.vault.data.size).toBe(0);
  });

  test("a failed store open removes the envelopes and the store file it created", async () => {
    const h = harness();
    h.vault.hooks.openFails = true;

    const error = await rejection(h.service().setup({}));

    expect(error).toBeInstanceOf(StoreError);
    expect(h.vault.data.size).toBe(0);
  });

  test("a file that appears during setup is kept; only what setup wrote is removed", async () => {
    const h = harness();
    h.vault.hooks.beforeWrite = (name) => {
      if (name === RECOVERY) h.vault.data.set(RECOVERY, new Uint8Array([9]));
    };

    const error = await rejection(h.service().setup({}));

    expect(error).toBeInstanceOf(VaultFileError);
    expect(error.message).toBe("The vault file data-key.recovery already exists.");
    expect(h.vault.snapshot()).toEqual({ [RECOVERY]: "09" });
  });
});

describe("start", () => {
  test("opens the OS envelope and the store, writes nothing, zeroes the data key", async () => {
    const h = harness();
    await h.service().setup({});
    const before = h.vault.snapshot();

    await h.service().start();

    expect(h.vault.opened.at(-1)).toEqual({ key: DEK_HEX, closed: false });
    expect(hex(h.vault.givenKeys.at(-1) ?? new Uint8Array(1))).toBe(hex(new Uint8Array(32)));
    expect(h.vault.snapshot()).toEqual(before);
  });

  test("a passphrase vault asks for the passphrase", async () => {
    let asked = 0;
    const h = harness({
      askPassphrase: async () => {
        asked++;
        return USER_PASSPHRASE;
      },
    });
    h.os.state.availability = NO_TPM2;
    await h.service().setup({ passphrase: USER_PASSPHRASE });

    await h.service().start();

    expect(asked).toBe(1);
    expect(h.vault.opened.at(-1)).toEqual({ key: DEK_HEX, closed: false });
  });

  test("a wrong passphrase is the one open error, and no store is opened", async () => {
    const h = harness({ askPassphrase: ask("wrong passphrase") });
    h.os.state.availability = NO_TPM2;
    await h.service().setup({ passphrase: USER_PASSPHRASE });

    const error = await rejection(h.service().start());

    expect(error).toBeInstanceOf(EnvelopeOpenError);
    expect(h.vault.opened).toHaveLength(1);
  });

  test("a passphrase vault without a prompt is refused", async () => {
    const h = harness();
    h.os.state.availability = NO_TPM2;
    await h.service().setup({ passphrase: USER_PASSPHRASE });

    const error = await rejection(h.service().start());

    expect(error).toBeInstanceOf(PassphraseRequiredError);
    expect(error.message).toBe(
      "A passphrase is needed: the data key is sealed with a passphrase and no prompt was given.",
    );
  });

  test("another TPM or user: needs recovery, nothing written, no store opened", async () => {
    const h = harness();
    await h.service().setup({});
    h.keys.reset();
    const before = h.vault.snapshot();
    h.os.state.machine = "machine-b";

    const error = await rejection(h.service().start());

    expect(error).toBeInstanceOf(VaultStateError);
    expect((error as VaultStateError).state).toBe("needs-recovery");
    expect(error.message).toBe(
      "goop cannot start the vault: the OS or passphrase envelope of the data key is missing or cannot be opened here; enter the recovery key.",
    );
    expect(h.vault.snapshot()).toEqual(before);
    expect(h.vault.opened).toHaveLength(1);
    expect(h.keys.newKeys()).toBe(0);
  });

  test("a busy OS key store (DPAPI) is unavailable, never a lost key; nothing written", async () => {
    const h = harness();
    await h.service().setup({});
    const before = h.vault.snapshot();
    h.os.state.busyOnOpen = true;

    const error = await rejection(h.service().start());

    expect(error).toBeInstanceOf(KeyStoreUnavailableError);
    expect((error as KeyStoreUnavailableError).reason).toBe("busy");
    expect(h.vault.snapshot()).toEqual(before);
  });

  test("an OS key store gone unavailable, with no passphrase envelope, is unavailable", async () => {
    const h = harness();
    await h.service().setup({});
    h.os.state.availability = NO_TPM2;

    const error = await rejection(h.service().start());

    expect(error).toBeInstanceOf(KeyStoreUnavailableError);
    expect((error as KeyStoreUnavailableError).reason).toBe("no-tpm2");
  });

  test("an OS envelope that cannot be used falls back to a passphrase envelope", async () => {
    const h = harness({ askPassphrase: ask(USER_PASSPHRASE) });
    await h.service().setup({});
    h.os.state.availability = NO_TPM2;
    await h.service().recover(RECOVERY_KEY, USER_PASSPHRASE);

    await h.service().start();

    expect(h.vault.opened.at(-1)).toEqual({ key: DEK_HEX, closed: false });
  });

  test.each(["first-run", "needs-recovery", "needs-backup", "store-missing"] as const)(
    "refused in %p, naming the state; nothing written",
    async (state) => {
      const h = harness();
      await arrange(h, state);
      const before = h.vault.snapshot();

      const error = await rejection(h.service().start());

      expect(error).toBeInstanceOf(VaultStateError);
      expect((error as VaultStateError).state).toBe(state);
      expect(error.message).toStartWith("goop cannot start the vault: ");
      expect(h.vault.snapshot()).toEqual(before);
    },
  );

  test("a missing store is a warning that touches nothing", async () => {
    const h = harness();
    await arrange(h, "store-missing");

    const error = await rejection(h.service().start());

    expect(error.message).toBe(
      "goop cannot start the vault: the envelopes of the data key exist but the store is missing; restore the store from a backup. goop changed nothing.",
    );
  });
});

describe("recover", () => {
  test("missing OS envelope: writes a new one with the same data key; the next start works", async () => {
    const h = harness();
    await arrange(h, "needs-recovery");
    const recoveryBefore = h.vault.snapshot()[RECOVERY];
    const storeBefore = h.vault.snapshot()[STORE];

    await h.service().recover(RECOVERY_KEY);

    expect(h.vault.opened.at(-1)).toEqual({ key: DEK_HEX, closed: false });
    expect(hex(h.vault.data.get(OS) ?? new Uint8Array())).toBe(
      hex(join(encode("os:machine-a:"), new Uint8Array(32).fill(DEK_BYTE))),
    );
    expect(h.vault.snapshot()[RECOVERY]).toBe(recoveryBefore);
    expect(h.vault.snapshot()[STORE]).toBe(storeBefore);
    expect(h.keys.newKeys()).toBe(0);
    expect(hex(h.vault.givenKeys.at(-1) ?? new Uint8Array(1))).toBe(hex(new Uint8Array(32)));

    await h.service().start();
    expect(h.vault.opened.at(-1)).toEqual({ key: DEK_HEX, closed: false });
  });

  test("another TPM: replaces the OS envelope; the next start works", async () => {
    const h = harness();
    await h.service().setup({});
    h.os.state.machine = "machine-b";
    await rejection(h.service().start());

    await h.service().recover(RECOVERY_KEY);
    await h.service().start();

    expect(hex(h.vault.data.get(OS) ?? new Uint8Array())).toBe(
      hex(join(encode("os:machine-b:"), new Uint8Array(32).fill(DEK_BYTE))),
    );
    expect(h.vault.opened.at(-1)).toEqual({ key: DEK_HEX, closed: false });
  });

  test("without the OS key store: writes a passphrase envelope", async () => {
    const h = harness({ askPassphrase: ask(USER_PASSPHRASE) });
    await arrange(h, "needs-recovery");
    h.os.state.availability = NO_TPM2;

    await h.service().recover(RECOVERY_KEY, USER_PASSPHRASE);

    expect(h.vault.data.has(OS)).toBe(false);
    expect(hex(h.vault.data.get(PASSPHRASE) ?? new Uint8Array())).toBe(
      hex(join(encode(`passphrase:${USER_PASSPHRASE}:`), new Uint8Array(32).fill(DEK_BYTE))),
    );
    await h.service().start();
    expect(h.vault.opened.at(-1)).toEqual({ key: DEK_HEX, closed: false });
  });

  test("without the OS key store and without a passphrase: refused before opening anything", async () => {
    const h = harness();
    await arrange(h, "needs-recovery");
    h.os.state.availability = NO_TPM2;
    const before = h.vault.snapshot();

    const error = await rejection(h.service().recover(RECOVERY_KEY));

    expect(error).toBeInstanceOf(PassphraseRequiredError);
    expect(h.vault.snapshot()).toEqual(before);
    expect(h.vault.opened).toHaveLength(1);
  });

  test("a wrong recovery key is the one open error; nothing written", async () => {
    const h = harness();
    await arrange(h, "needs-recovery");
    const before = h.vault.snapshot();

    const error = await rejection(h.service().recover("RKEY-WRONG"));

    expect(error).toBeInstanceOf(EnvelopeOpenError);
    expect(h.vault.snapshot()).toEqual(before);
  });

  test("a data key that does not open the store fails fast; nothing written", async () => {
    const h = harness();
    await arrange(h, "needs-recovery");
    h.vault.data.set(STORE, new Uint8Array(32).fill(1));
    const before = h.vault.snapshot();

    const error = await rejection(h.service().recover(RECOVERY_KEY));

    expect(error).toBeInstanceOf(StoreOpenError);
    expect(h.vault.snapshot()).toEqual(before);
  });

  test("a busy OS key store while sealing: unavailable, the store closed, nothing written", async () => {
    const h = harness();
    await arrange(h, "needs-recovery");
    h.os.state.busyOnSeal = true;
    const before = h.vault.snapshot();

    const error = await rejection(h.service().recover(RECOVERY_KEY));

    expect(error).toBeInstanceOf(KeyStoreUnavailableError);
    expect(h.vault.opened.at(-1)).toEqual({ key: DEK_HEX, closed: true });
    expect(h.vault.snapshot()).toEqual(before);
  });

  test.each(["first-run", "needs-backup", "store-missing"] as const)(
    "refused in %p; nothing written",
    async (state) => {
      const h = harness();
      await arrange(h, state);
      const before = h.vault.snapshot();

      const error = await rejection(h.service().recover(RECOVERY_KEY));

      expect(error).toBeInstanceOf(VaultStateError);
      expect((error as VaultStateError).state).toBe(state);
      expect(h.vault.snapshot()).toEqual(before);
    },
  );

  test("a ready vault without its recovery envelope cannot be recovered", async () => {
    const h = harness();
    await h.service().setup({});
    h.vault.data.delete(RECOVERY);

    const error = await rejection(h.service().recover(RECOVERY_KEY));

    expect(error).toBeInstanceOf(VaultFileError);
    expect(error.message).toBe("The vault file data-key.recovery is missing.");
  });
});
