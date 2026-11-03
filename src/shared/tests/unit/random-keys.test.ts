import { describe, expect, test } from "bun:test";
import {
  newDataKey,
  newRecoveryKey,
  openPassphraseEnvelope,
  openRecoveryEnvelope,
  sealWithPassphrase,
  sealWithRecoveryKey,
} from "@/shared";

const SHAPE = /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/;

describe("fresh keys", () => {
  test("a data key is 32 random bytes, different every time", () => {
    const first = newDataKey();
    const second = newDataKey();

    expect(first).toBeInstanceOf(Uint8Array);
    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(first).not.toEqual(second);
  });

  test("a recovery key is 8 groups of 4 Crockford base32 characters, different every time", () => {
    const keys = Array.from({ length: 8 }, () => newRecoveryKey());

    for (const key of keys) expect(key).toMatch(SHAPE);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("sealing with fresh randomness", () => {
  test("two recovery seals of one data key differ in salt and nonce, and both open", async () => {
    const dek = newDataKey();
    const recoveryKey = newRecoveryKey();
    const first = await sealWithRecoveryKey(dek, recoveryKey);
    const second = await sealWithRecoveryKey(dek, recoveryKey);

    expect(first.slice(2, 18)).not.toEqual(second.slice(2, 18));
    expect(first.slice(18, 30)).not.toEqual(second.slice(18, 30));
    expect(await openRecoveryEnvelope(first, recoveryKey)).toEqual(dek);
    expect(await openRecoveryEnvelope(second, recoveryKey)).toEqual(dek);
  });

  test("a passphrase seal opens with the same passphrase", async () => {
    const dek = newDataKey();
    const envelope = await sealWithPassphrase(dek, "tortilla de patatas");

    expect(envelope).toHaveLength(78);
    expect(await openPassphraseEnvelope(envelope, "tortilla de patatas")).toEqual(dek);
  });
});
