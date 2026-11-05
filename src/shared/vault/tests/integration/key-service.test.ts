// The key service wired to the real vault pieces: the folder on disk, the real envelopes and the
// sqlite3mc store. Only the OS key store is a fake, so nothing touches the system (local-env.md).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type EncryptedStore,
  EnvelopeOpenError,
  keyService,
  newDataKey,
  nodeVaultFiles,
  type OsEnvelopeAvailability,
  OsEnvelopeOpenError,
  type OsKeyEnvelope,
  StoreOpenError,
  sqlite3mcEngine,
  VaultStateError,
} from "@/shared/vault";

const repo = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const library = [
  join(repo, ".local", "build", "native", "linux-x64", "libsqlite3mc.so"),
  join(repo, ".local", "build", "sqlite", "libsqlite3mc.so"),
].find(existsSync);
const missing = process.platform !== "linux" || library === undefined;
const PASSPHRASE = "correct horse battery staple";
const TIMEOUT = 30_000;

/** A stand-in for systemd-creds or DPAPI: a blob opens only on the machine that sealed it. */
function fakeOs(machine: string, availability: OsEnvelopeAvailability = { available: true }) {
  const tag = new TextEncoder().encode(`fake-os:${machine}:`);
  const envelope: OsKeyEnvelope = {
    availability: async () => availability,
    seal: async (dek) => new Uint8Array([...tag, ...dek]),
    async open(sealed) {
      if (sealed.length !== tag.length + 32 || !tag.every((byte, i) => sealed[i] === byte)) {
        throw new OsEnvelopeOpenError();
      }
      return sealed.slice(tag.length);
    },
  };
  return envelope;
}

const NO_TPM2: OsEnvelopeAvailability = {
  available: false,
  reason: "no-tpm2",
  message: "This machine has no TPM2.",
};

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

describe.skipIf(missing)(
  "key service end to end (skipped without libsqlite3mc.so under .local/build; run `bun run native:build`)",
  () => {
    let root = "";
    let folder = "";
    const open: EncryptedStore[] = [];

    beforeEach(() => {
      root = join(repo, ".temp", "tests", `key-service-${crypto.randomUUID()}`);
      folder = join(root, "data");
    });

    afterEach(() => {
      for (const store of open.splice(0)) store.close();
      rmSync(root, { recursive: true, force: true });
    });

    const service = (os: OsKeyEnvelope, askPassphrase?: () => Promise<string>) =>
      keyService({
        files: nodeVaultFiles(folder),
        os,
        engine: sqlite3mcEngine({ library: library ?? "" }),
        ...(askPassphrase ? { askPassphrase } : {}),
      });
    const kept = (store: EncryptedStore) => {
      open.push(store);
      return store;
    };
    const notes = (store: EncryptedStore) => store.query("SELECT body FROM notes");

    test(
      "setup, close, start: the rows read back with the same data key",
      async () => {
        const os = fakeOs("machine-a");
        const { recoveryKey, store } = await service(os).setup({});
        store.run("CREATE TABLE notes (body TEXT)");
        store.run("INSERT INTO notes (body) VALUES (?)", ["first note"]);
        store.close();

        expect(recoveryKey).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
        expect(statSync(join(folder, "data-key.recovery")).size).toBe(78);
        expect(statSync(join(folder, "data-key.os")).mode & 0o777).toBe(0o600);
        expect(existsSync(join(folder, "data-key.passphrase"))).toBe(false);
        expect(notes(kept(await service(os).start()))).toEqual([{ body: "first note" }]);
      },
      TIMEOUT,
    );

    test(
      "the new store already refuses another key",
      async () => {
        (await service(fakeOs("machine-a")).setup({})).store.close();

        expect(() =>
          sqlite3mcEngine({ library: library ?? "" }).open(join(folder, "goop.db"), newDataKey()),
        ).toThrow(StoreOpenError);
      },
      TIMEOUT,
    );

    test(
      "another machine needs recovery; the recovery key writes a new OS envelope",
      async () => {
        const { recoveryKey, store } = await service(fakeOs("machine-a")).setup({});
        store.run("CREATE TABLE notes (body TEXT)");
        store.run("INSERT INTO notes (body) VALUES (?)", ["kept across machines"]);
        store.close();
        const other = fakeOs("machine-b");

        const error = await rejection(service(other).start());
        expect(error).toBeInstanceOf(VaultStateError);
        expect((error as VaultStateError).state).toBe("needs-recovery");

        const recovered = kept(await service(other).recover(recoveryKey));
        expect(notes(recovered)).toEqual([{ body: "kept across machines" }]);
        recovered.close();
        expect(notes(kept(await service(other).start()))).toEqual([
          { body: "kept across machines" },
        ]);
      },
      TIMEOUT,
    );

    test(
      "without the OS key store, the passphrase envelope opens the vault",
      async () => {
        const os = fakeOs("machine-a", NO_TPM2);
        const { store } = await service(os).setup({ passphrase: PASSPHRASE });
        store.run("CREATE TABLE notes (body TEXT)");
        store.run("INSERT INTO notes (body) VALUES (?)", ["sealed by passphrase"]);
        store.close();

        expect(existsSync(join(folder, "data-key.os"))).toBe(false);
        const wrong = await rejection(service(os, async () => "wrong").start());
        expect(wrong).toBeInstanceOf(EnvelopeOpenError);
        expect(notes(kept(await service(os, async () => PASSPHRASE).start()))).toEqual([
          { body: "sealed by passphrase" },
        ]);
      },
      TIMEOUT,
    );
  },
);
