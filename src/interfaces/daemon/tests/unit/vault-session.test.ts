import { describe, expect, test } from "bun:test";
import {
  VaultSecretError,
  type VaultSession,
  VaultStatusError,
  vaultSession,
} from "@/interfaces/daemon/services/vault-session";
import {
  type FakeVault,
  fakeVault,
  PASSPHRASE,
  RECOVERY_KEY,
  SECRETS,
  WRONG,
} from "@/interfaces/daemon/tests/unit/fake-vault";
import { KeyStoreUnavailableError, VaultStateError } from "@/shared/vault";

const sessionOf = (vault: FakeVault): VaultSession =>
  vaultSession({
    files: vault.files,
    os: vault.osEnvelope,
    keys: vault.keys,
    loadEngine: vault.loadEngine,
  });

/** The rejection of `promise`; its message never holds a secret. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    for (const secret of SECRETS) expect((error as Error).message).not.toContain(secret);
    return error as Error;
  }
  throw new Error("expected a rejection");
}

async function expectWrongState(promise: Promise<unknown>, state: string) {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(VaultStatusError);
  expect((error as VaultStatusError).state).toBe(state as VaultStatusError["state"]);
}

/** A vault set up with a passphrase (no OS key store), then a daemon started over it. */
async function lockedVault() {
  const vault = fakeVault();
  const first = sessionOf(vault);
  await first.open();
  await first.setup(PASSPHRASE);
  first.close();
  const session = sessionOf(vault);
  return { vault, session };
}

describe("vaultSession: a first run (daemon-ipc S7)", () => {
  test("opens as first-run, needs no native library and only allows setup", async () => {
    const vault = fakeVault();
    const session = sessionOf(vault);

    expect(await session.open()).toBe("first-run");
    expect(await session.status()).toBe("first-run");
    expect(vault.counts.engines).toBe(0);
    expect(session.store()).toBeUndefined();
    await expectWrongState(session.unlock(PASSPHRASE), "first-run");
    await expectWrongState(session.recover(RECOVERY_KEY, PASSPHRASE), "first-run");
    expect(vault.data.size).toBe(0);
  });

  test("setup returns the recovery key once and leaves the vault unlocked", async () => {
    const vault = fakeVault();
    const session = sessionOf(vault);
    await session.open();

    expect(await session.setup(PASSPHRASE)).toBe(RECOVERY_KEY);
    expect(await session.status()).toBe("unlocked");
    expect(session.store()).toBeDefined();
    expect(vault.counts.engines).toBe(1);
    expect([...vault.data.keys()].sort()).toEqual([
      "data-key.passphrase",
      "data-key.recovery",
      "goop.db",
    ]);
    await expectWrongState(session.setup(PASSPHRASE), "unlocked");
  });
});

describe("vaultSession: a vault sealed with a passphrase (daemon-ipc L8)", () => {
  test("opens locked and opens no store until it is unlocked", async () => {
    const { vault, session } = await lockedVault();
    const opened = vault.opened.length;

    expect(await session.open()).toBe("locked");
    expect(session.store()).toBeUndefined();
    expect(vault.opened.length).toBe(opened);
    await expectWrongState(session.setup(PASSPHRASE), "locked");
    await expectWrongState(session.recover(RECOVERY_KEY, PASSPHRASE), "locked");
  });

  test("a wrong or malformed passphrase is one error, and the vault stays locked", async () => {
    const { session } = await lockedVault();
    await session.open();

    for (const wrong of [WRONG, "short"]) {
      expect(await rejection(session.unlock(wrong))).toBeInstanceOf(VaultSecretError);
      expect(await session.status()).toBe("locked");
      expect(session.store()).toBeUndefined();
    }
  });

  test("the right passphrase unlocks it, once", async () => {
    const { session } = await lockedVault();
    await session.open();

    expect(await session.unlock(PASSPHRASE)).toBe("unlocked");
    expect(session.store()).toBeDefined();
    await expectWrongState(session.unlock(PASSPHRASE), "unlocked");
  });

  test("two unlocks at once run one after the other", async () => {
    const { session } = await lockedVault();
    await session.open();

    const [first, second] = await Promise.allSettled([
      session.unlock(PASSPHRASE),
      session.unlock(PASSPHRASE),
    ]);
    expect(first).toEqual({ status: "fulfilled", value: "unlocked" });
    expect(second.status).toBe("rejected");
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(VaultStatusError);
  });

  test("close closes the store", async () => {
    const { vault, session } = await lockedVault();
    await session.open();
    await session.unlock(PASSPHRASE);

    session.close();
    expect(vault.opened.at(-1)?.closed).toBe(true);
    expect(session.store()).toBeUndefined();
  });
});

describe("vaultSession: a working OS key store (daemon-ipc L8)", () => {
  test("a vault sealed by it unlocks by itself and never waits", async () => {
    const vault = fakeVault({ available: true });
    const first = sessionOf(vault);
    await first.open();
    await first.setup(PASSPHRASE);
    first.close();
    expect(vault.data.has("data-key.os")).toBe(true);

    const session = sessionOf(vault);
    expect(await session.open()).toBe("unlocked");
    expect(session.store()).toBeDefined();
  });

  test("an OS envelope from another machine needs the recovery key", async () => {
    const vault = fakeVault({ available: true });
    const first = sessionOf(vault);
    await first.open();
    await first.setup(PASSPHRASE);
    first.close();
    vault.os.machine = "machine-b";

    expect(await sessionOf(vault).open()).toBe("needs-recovery");
  });

  test("a busy OS key store is never a switch to the passphrase: open fails", async () => {
    const vault = fakeVault({ available: true });
    const first = sessionOf(vault);
    await first.open();
    await first.setup(PASSPHRASE);
    first.close();
    vault.os.availability = { available: false, reason: "busy", message: "DPAPI is busy." };

    expect(await rejection(sessionOf(vault).open())).toBeInstanceOf(KeyStoreUnavailableError);
  });

  test("a busy OS key store with a passphrase envelope too is still never locked: open fails", async () => {
    const vault = fakeVault({ available: true });
    const first = sessionOf(vault);
    await first.open();
    await first.setup(PASSPHRASE);
    first.close();
    vault.data.set(
      "data-key.passphrase",
      await vault.keys.sealWithPassphrase(new Uint8Array(32).fill(7), PASSPHRASE),
    );
    vault.os.availability = { available: false, reason: "busy", message: "DPAPI is busy." };
    const session = sessionOf(vault);

    const error = await rejection(session.open());

    expect(error).toBeInstanceOf(KeyStoreUnavailableError);
    expect((error as KeyStoreUnavailableError).reason).toBe("busy");
    expect(session.store()).toBeUndefined();
  });
});

describe("vaultSession: recovery (daemon-ipc S7)", () => {
  async function needsRecovery() {
    const { vault, session } = await lockedVault();
    vault.data.delete("data-key.passphrase");
    await session.open();
    return { vault, session };
  }

  test("a vault without its passphrase envelope opens as needs-recovery and only allows recover", async () => {
    const { session } = await needsRecovery();

    expect(await session.status()).toBe("needs-recovery");
    await expectWrongState(session.unlock(PASSPHRASE), "needs-recovery");
    await expectWrongState(session.setup(PASSPHRASE), "needs-recovery");
  });

  test("a wrong or malformed recovery key is the same one error, and nothing changes", async () => {
    const { vault, session } = await needsRecovery();
    const before = [...vault.data.keys()].sort();

    for (const wrong of [WRONG, "short"]) {
      expect(await rejection(session.recover(wrong, PASSPHRASE))).toBeInstanceOf(VaultSecretError);
      expect(await session.status()).toBe("needs-recovery");
    }
    expect([...vault.data.keys()].sort()).toEqual(before);
  });

  test("the right recovery key unlocks it with a new passphrase for the next start", async () => {
    const { vault, session } = await needsRecovery();
    const next = "next-passphrase-SECRET";

    expect(await session.recover(RECOVERY_KEY, next)).toBe("unlocked");
    expect(session.store()).toBeDefined();
    session.close();

    const restarted = sessionOf(vault);
    expect(await restarted.open()).toBe("locked");
    expect(await rejection(restarted.unlock(PASSPHRASE))).toBeInstanceOf(VaultSecretError);
    expect(await restarted.unlock(next)).toBe("unlocked");
  });
});

describe("vaultSession: a vault only a backup can help", () => {
  test("a store without envelopes or envelopes without a store refuse to open", async () => {
    const { vault } = await lockedVault();
    const backup = new Map(vault.data);

    vault.data.delete("data-key.passphrase");
    vault.data.delete("data-key.recovery");
    const noEnvelopes = await rejection(sessionOf(vault).open());
    expect(noEnvelopes).toBeInstanceOf(VaultStateError);
    expect((noEnvelopes as VaultStateError).state).toBe("needs-backup");

    for (const [name, bytes] of backup) vault.data.set(name, bytes);
    vault.data.delete("goop.db");
    const noStore = await rejection(sessionOf(vault).open());
    expect((noStore as VaultStateError).state).toBe("store-missing");
  });
});
