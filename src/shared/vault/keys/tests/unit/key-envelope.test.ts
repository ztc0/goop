import { beforeAll, describe, expect, test } from "bun:test";
import {
  EnvelopeFormatError,
  EnvelopeOpenError,
  formatRecoveryKey,
  KeyInputError,
  openPassphraseEnvelope,
  openRecoveryEnvelope,
  parseRecoveryKey,
  sealPassphraseEnvelope,
  sealRecoveryEnvelope,
} from "../../model/key-envelope";
import type { Bytes } from "../../types/key-envelope";

const range = (start: number, length: number): Bytes =>
  new Uint8Array(Array.from({ length }, (_, index) => start + index));
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

// Fixed inputs. The expected envelopes were computed independently with node:crypto
// (createCipheriv, hkdfSync, scryptSync), so a change to the format is caught here.
const DEK = range(0x00, 32);
const FIXED = { salt: range(0xa0, 16), nonce: range(0xb0, 12) };
const RECOVERY_KEY = "0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ";
const OTHER_RECOVERY_KEY = "ZZZZ-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ";
const PASSPHRASE = "correct horse battery staple";
const HEADER = "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babb";
const RECOVERY_VECTOR = `0101${HEADER}69f6bf3abd57d7a273e93a8527635c9271d1be16b9f5333d9b7e767568af75d9f2f84bb945328d2e55f14d0e3a577c3b`;
const PASSPHRASE_VECTOR = `0102${HEADER}6e7ea0fb81722aabb9bf99f39f17d7fc716d1dff26171cf0d500b964e6b6786dd1eeb62f1b7dc6313853ad1d6b954b3f`;

const OPEN_FAILED =
  "The envelope could not be opened: it was changed, or the key or passphrase is wrong.";

function flipped(envelope: Bytes, index: number): Bytes {
  const copy = new Uint8Array(envelope);
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

describe("recovery envelope", () => {
  let envelope: Bytes;
  beforeAll(async () => {
    envelope = await sealRecoveryEnvelope(DEK, RECOVERY_KEY, FIXED);
  });

  test("seals to the pinned version 1 bytes and opens back to the data key", async () => {
    expect(hex(envelope)).toBe(RECOVERY_VECTOR);
    expect(await openRecoveryEnvelope(envelope, RECOVERY_KEY)).toEqual(DEK);
  });

  test("a change in the salt, nonce, ciphertext or tag is refused with the one error", async () => {
    // Salt starts at 2, nonce at 18, ciphertext at 30; the tag is the last 16 bytes.
    for (const index of [2, 17, 18, 29, 30, 61, 62, 77]) {
      const error = await rejection(openRecoveryEnvelope(flipped(envelope, index), RECOVERY_KEY));
      expect(error).toBeInstanceOf(EnvelopeOpenError);
      expect(error.message).toBe(OPEN_FAILED);
    }
  });

  test("a data key, salt or nonce of the wrong size is never sealed", async () => {
    // Each attempt starts only when it is awaited, so no rejection is left unhandled.
    const cases: [() => Promise<unknown>, string][] = [
      [
        () => sealRecoveryEnvelope(DEK.slice(1), RECOVERY_KEY, FIXED),
        "The data key must be 32 bytes, not 31.",
      ],
      [
        () => sealRecoveryEnvelope(DEK, RECOVERY_KEY, { ...FIXED, salt: DEK }),
        "The salt must be 16 bytes, not 32.",
      ],
      [
        () => sealRecoveryEnvelope(DEK, RECOVERY_KEY, { ...FIXED, nonce: DEK }),
        "The nonce must be 12 bytes, not 32.",
      ],
    ];
    for (const [attempt, message] of cases) {
      const error = await rejection(attempt());
      expect(error).toBeInstanceOf(RangeError);
      expect(error.message).toBe(message);
    }
  });

  test("a wrong recovery key is refused with the same error", async () => {
    const error = await rejection(openRecoveryEnvelope(envelope, OTHER_RECOVERY_KEY));
    expect(error).toBeInstanceOf(EnvelopeOpenError);
    expect(error.message).toBe(OPEN_FAILED);
  });

  test("the forgiving typed forms open it", async () => {
    for (const typed of [
      "0123-4567-89ab-cdef-ghjk-mnpq-rstv-wxyz",
      "0123 4567 89AB CDEF GHJK MNPQ RSTV WXYZ",
      "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
      "  O123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ\n",
    ]) {
      expect(await openRecoveryEnvelope(envelope, typed)).toEqual(DEK);
    }
  });

  test("a changed version or kind byte is refused with a format error", async () => {
    const version = await rejection(openRecoveryEnvelope(flipped(envelope, 0), RECOVERY_KEY));
    expect(version).toBeInstanceOf(EnvelopeFormatError);
    expect(version.message).toBe("Unknown envelope version 0: this goop reads version 1.");

    const kind = await rejection(openRecoveryEnvelope(flipped(envelope, 1), RECOVERY_KEY));
    expect(kind).toBeInstanceOf(EnvelopeFormatError);
    expect(kind.message).toBe("Unknown envelope kind 0.");
  });

  test("an unknown version is refused before its length is checked", async () => {
    const error = await rejection(openRecoveryEnvelope(new Uint8Array([2, 1, 0]), RECOVERY_KEY));
    expect(error).toBeInstanceOf(EnvelopeFormatError);
    expect(error.message).toBe("Unknown envelope version 2: this goop reads version 1.");
  });

  test("a truncated, empty or oversized envelope is refused with its size", async () => {
    const cases: [Bytes, string][] = [
      [envelope.slice(0, 77), "The envelope is truncated: 77 bytes, expected 78."],
      [new Uint8Array(0), "The envelope is truncated: 0 bytes, expected 78."],
      [new Uint8Array([...envelope, 0]), "The envelope is too long: 79 bytes, expected 78."],
    ];
    for (const [bytes, message] of cases) {
      const error = await rejection(openRecoveryEnvelope(bytes, RECOVERY_KEY));
      expect(error).toBeInstanceOf(EnvelopeFormatError);
      expect(error.message).toBe(message);
    }
  });
});

describe("passphrase envelope", () => {
  let envelope: Bytes;
  beforeAll(async () => {
    envelope = await sealPassphraseEnvelope(DEK, PASSPHRASE, FIXED);
  });

  test("seals to the pinned version 1 bytes, with scrypt N=2^17 r=8 p=1", () => {
    expect(hex(envelope)).toBe(PASSPHRASE_VECTOR);
  });

  test("a wrong passphrase is refused with the one error", async () => {
    const error = await rejection(openPassphraseEnvelope(envelope, "correct horse battery"));
    expect(error).toBeInstanceOf(EnvelopeOpenError);
    expect(error.message).toBe(OPEN_FAILED);
  });

  test("an empty passphrase is refused before any derivation", async () => {
    for (const attempt of [
      () => sealPassphraseEnvelope(DEK, "", FIXED),
      () => openPassphraseEnvelope(envelope, ""),
    ]) {
      const error = await rejection(attempt());
      expect(error).toBeInstanceOf(KeyInputError);
      expect(error.message).toBe("The passphrase is empty.");
    }
  });

  test("each opener refuses the other kind with a clear error", async () => {
    const asRecovery = await rejection(openRecoveryEnvelope(envelope, RECOVERY_KEY));
    expect(asRecovery).toBeInstanceOf(EnvelopeFormatError);
    expect(asRecovery.message).toBe("This is a passphrase envelope: open it with the passphrase.");

    const recovery = await sealRecoveryEnvelope(DEK, RECOVERY_KEY, FIXED);
    const asPassphrase = await rejection(openPassphraseEnvelope(recovery, PASSPHRASE));
    expect(asPassphrase).toBeInstanceOf(EnvelopeFormatError);
    expect(asPassphrase.message).toBe(
      "This is a recovery envelope: open it with the recovery key.",
    );
  });
});

describe("recovery key text", () => {
  test("160 bits are written as 8 groups of 4 Crockford base32 characters, and read back", () => {
    const bits = parseRecoveryKey(RECOVERY_KEY);

    expect(hex(bits)).toBe("00443214c74254b635cf84653a56d7c675be77df");
    expect(formatRecoveryKey(bits)).toBe(RECOVERY_KEY);
    expect(formatRecoveryKey(range(0xec, 20))).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-Z]{4}$/);
  });

  test("an invalid recovery key is refused with the problem it has", () => {
    const cases: [string, string][] = [
      [
        "0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXY",
        "The recovery key has 31 characters; it needs 32.",
      ],
      ["", "The recovery key has 0 characters; it needs 32."],
      [
        "0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ0",
        "The recovery key has 33 characters; it needs 32.",
      ],
      [
        // The length is checked first, so a long paste is refused before any parsing.
        "u".repeat(40),
        "The recovery key has 40 characters; it needs 32.",
      ],
      [
        "0123-4567-89AB-CDEF-GHJK-MNPQ-RSTu-WXYZ",
        'The recovery key contains "u", which it never uses.',
      ],
      [
        "0123-4567-89AB-CDEF-GHJK-MNPQ-RST_-WXYZ",
        'The recovery key contains "_", which it never uses.',
      ],
      [
        "0123-4567-89AB-CDEF-GHJK-MNPQ-RSTı-WXYZ",
        'The recovery key contains "ı", which it never uses.',
      ],
    ];
    for (const [typed, message] of cases) {
      expect(() => parseRecoveryKey(typed)).toThrow(KeyInputError);
      expect(() => parseRecoveryKey(typed)).toThrow(message);
    }
  });

  test("an invalid recovery key is refused before any decryption", async () => {
    const envelope = await sealRecoveryEnvelope(DEK, RECOVERY_KEY, FIXED);
    const error = await rejection(openRecoveryEnvelope(envelope, "0123-4567"));
    expect(error).toBeInstanceOf(KeyInputError);
    expect(error.message).toBe("The recovery key has 8 characters; it needs 32.");
  });
});
