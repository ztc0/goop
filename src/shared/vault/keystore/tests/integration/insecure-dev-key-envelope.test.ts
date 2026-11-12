// The insecure development key (dev-sandbox S8) on a real folder under `.temp/tests/`: it seals
// and opens the data key with the key in `INSECURE-DEV-KEY`, created once and never replaced.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { newDataKey, newRecoveryKey } from "@/shared/vault/keys";
import {
  INSECURE_DEV_KEY_FILE,
  InsecureDevKeyRefusedError,
  insecureDevKeyEnvelope,
  OsEnvelopeOpenError,
  OsEnvelopeSealError,
} from "@/shared/vault/keystore";

const repo = resolve(import.meta.dir, "..", "..", "..", "..", "..", "..");
const OPEN_FAILED =
  "The OS key envelope could not be opened: it was changed, or it belongs to another user, machine or name.";
const REFUSED = "The compiled goop never uses the insecure development key.";
const posix = process.platform !== "win32";

let fixture: string;
let folder: string;

beforeEach(() => {
  fixture = join(repo, ".temp", "tests", `insecure-dev-key-${crypto.randomUUID()}`);
  mkdirSync(fixture, { recursive: true });
  folder = join(fixture, "dev");
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

const keyFile = () => join(folder, INSECURE_DEV_KEY_FILE);
const failure = (call: Promise<unknown>) =>
  call.then(
    () => undefined,
    (error: unknown) => error,
  );

describe("insecureDevKeyEnvelope (dev-sandbox S8)", () => {
  test("is named INSECURE-DEV-KEY and is always available", async () => {
    expect(INSECURE_DEV_KEY_FILE).toBe("INSECURE-DEV-KEY");
    expect(await insecureDevKeyEnvelope(folder).availability()).toEqual({ available: true });
    // Asking never creates anything.
    expect(existsSync(folder)).toBe(false);
  });

  test("seals and opens the same data key; the sealed bytes never hold it", async () => {
    const envelope = insecureDevKeyEnvelope(folder);
    const dek = newDataKey();
    const sealed = await envelope.seal(dek);

    expect(Buffer.from(sealed).includes(Buffer.from(dek))).toBe(false);
    expect(await envelope.open(sealed)).toEqual(dek);
    // Another envelope over the same folder opens it too: the key is on disk, not in memory.
    expect(await insecureDevKeyEnvelope(folder).open(sealed)).toEqual(dek);
  });

  test("the first seal creates the key file 0600 in a 0700 folder, and nothing else", async () => {
    await insecureDevKeyEnvelope(folder).seal(newDataKey());

    expect(readdirSync(folder)).toEqual([INSECURE_DEV_KEY_FILE]);
    if (posix) {
      expect(statSync(folder).mode & 0o777).toBe(0o700);
      expect(statSync(keyFile()).mode & 0o777).toBe(0o600);
    }
  });

  test("an existing folder open to others is tightened to 0700", async () => {
    mkdirSync(folder, { mode: 0o755 });
    chmodSync(folder, 0o755);
    await insecureDevKeyEnvelope(folder).seal(newDataKey());
    if (posix) expect(statSync(folder).mode & 0o777).toBe(0o700);
  });

  test("an existing key is never replaced: later seals use it", async () => {
    const envelope = insecureDevKeyEnvelope(folder);
    const first = await envelope.seal(newDataKey());
    const key = readFileSync(keyFile());

    const dek = newDataKey();
    const second = await insecureDevKeyEnvelope(folder).seal(dek);

    expect(readFileSync(keyFile())).toEqual(key);
    expect(await envelope.open(second)).toEqual(dek);
    expect(await envelope.open(first)).toHaveLength(32);
  });

  test("two first seals at once agree on one key", async () => {
    const [a, b] = [insecureDevKeyEnvelope(folder), insecureDevKeyEnvelope(folder)];
    const [dekA, dekB] = [newDataKey(), newDataKey()];
    const [sealedA, sealedB] = await Promise.all([a.seal(dekA), b.seal(dekB)]);

    expect(readdirSync(folder)).toEqual([INSECURE_DEV_KEY_FILE]);
    expect(await b.open(sealedA)).toEqual(dekA);
    expect(await a.open(sealedB)).toEqual(dekB);
  });

  test("a changed key file, a missing one or changed sealed bytes fail with the fixed open error", async () => {
    const envelope = insecureDevKeyEnvelope(folder);
    const sealed = await envelope.seal(newDataKey());

    const changed = new Uint8Array(sealed);
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    const errors = [
      await failure(envelope.open(changed)),
      await failure(envelope.open(new Uint8Array(0))),
    ];

    writeFileSync(keyFile(), newRecoveryKey());
    errors.push(await failure(envelope.open(sealed)));
    writeFileSync(keyFile(), "not a key");
    errors.push(await failure(envelope.open(sealed)));
    rmSync(keyFile());
    errors.push(await failure(envelope.open(sealed)));
    // Opening never creates a key.
    expect(existsSync(keyFile())).toBe(false);

    for (const error of errors) {
      expect(error).toBeInstanceOf(OsEnvelopeOpenError);
      expect((error as Error).message).toBe(OPEN_FAILED);
    }
  });

  test("a key file that is not a development key is never sealed with, nor replaced", async () => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(keyFile(), "not a key");

    const error = await failure(insecureDevKeyEnvelope(folder).seal(newDataKey()));

    expect(error).toBeInstanceOf(OsEnvelopeSealError);
    expect((error as Error).message).toBe(
      "The OS key store could not seal the data key: INSECURE-DEV-KEY does not hold a development key.",
    );
    expect(readFileSync(keyFile(), "utf8")).toBe("not a key");
  });

  test("the compiled goop refuses it before touching any file", () => {
    expect(() => insecureDevKeyEnvelope(folder, { standalone: true })).toThrow(
      new InsecureDevKeyRefusedError(),
    );
    expect(new InsecureDevKeyRefusedError().message).toBe(REFUSED);
    expect(existsSync(folder)).toBe(false);
  });
});
