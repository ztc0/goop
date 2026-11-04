// Envelopes that wrap the data key (S1-S4): a recovery key (HKDF-SHA256) or a passphrase
// (scrypt) derives an AES-256-GCM key that seals the DEK. Deterministic: the caller passes
// the salt and the nonce, so fixed values give fixed bytes. Fresh ones come from
// `adapters/random-keys`.
//
// Version 1 layout, 78 bytes:
//   version (1) | kind (1) | salt (16) | nonce (12) | ciphertext of the DEK (32) | tag (16)
// The first 30 bytes, the header, plus the label `goop-dek-v1` are the additional data, so
// AES-GCM refuses a change in any byte.
import { scrypt } from "node:crypto";
import type { Bytes, DataKey, EnvelopeKind, SealRandomness } from "../types/key-envelope";

const VERSION = 1;
const KIND_BYTE: Record<EnvelopeKind, number> = { recovery: 1, passphrase: 2 };
const DEK_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const HEADER_BYTES = 2 + SALT_BYTES + NONCE_BYTES;
const ENVELOPE_BYTES = HEADER_BYTES + DEK_BYTES + 16;
const LABEL = new TextEncoder().encode("goop-dek-v1");
const RECOVERY_INFO = new TextEncoder().encode("goop-recovery-kek-v1");
/** About 128 MiB and 0.3-0.4 s per derivation (T11 spike). Fixed for version 1. */
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;

// Crockford base32: no I, L, O or U, so a key read aloud or typed by hand is unambiguous.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_BYTES = 20;
const RECOVERY_CHARS = 32;

/** The envelope was changed, or the key or passphrase is wrong. It never says which. */
export class EnvelopeOpenError extends Error {
  override name = "EnvelopeOpenError";
  constructor() {
    super("The envelope could not be opened: it was changed, or the key or passphrase is wrong.");
  }
}

/** The bytes are not a version 1 envelope of the expected kind. */
export class EnvelopeFormatError extends Error {
  override name = "EnvelopeFormatError";
}

/** A typed recovery key or passphrase that cannot be used, refused before any decryption. */
export class KeyInputError extends Error {
  override name = "KeyInputError";
}

/** Every accepted typed character and its value: lowercase, `O` for 0, `I` and `L` for 1. */
const TYPED_VALUES = new Map<string, number>();
for (const [value, char] of [...ALPHABET].entries()) {
  TYPED_VALUES.set(char, value).set(char.toLowerCase(), value);
}
for (const char of "Oo") TYPED_VALUES.set(char, 0);
for (const char of "IiLl") TYPED_VALUES.set(char, 1);

/** 160 bits as 32 characters in 8 groups of 4: `XXXX-XXXX-...`. */
export function formatRecoveryKey(bits: Bytes): string {
  requireLength("A recovery key", bits, RECOVERY_BYTES);
  let number = 0n;
  for (const byte of bits) number = (number << 8n) | BigInt(byte);
  let text = "";
  for (let index = RECOVERY_CHARS - 1; index >= 0; index--) {
    text += ALPHABET[Number((number >> BigInt(index * 5)) & 31n)];
    if (index > 0 && index % 4 === 0) text += "-";
  }
  return text;
}

/** The 160 bits of a typed recovery key. Spaces and hyphens are ignored. */
export function parseRecoveryKey(typed: string): Bytes {
  const chars = [...typed.replace(/[\s-]/g, "")];
  // Checked before parsing: each BigInt shift copies the value, so a long paste would be slow.
  if (chars.length !== RECOVERY_CHARS) {
    throw new KeyInputError(
      `The recovery key has ${chars.length} characters; it needs ${RECOVERY_CHARS}.`,
    );
  }
  let number = 0n;
  for (const char of chars) {
    const value = TYPED_VALUES.get(char);
    if (value === undefined) {
      throw new KeyInputError(`The recovery key contains "${char}", which it never uses.`);
    }
    number = (number << 5n) | BigInt(value);
  }
  const bits = new Uint8Array(RECOVERY_BYTES);
  for (let index = 0; index < RECOVERY_BYTES; index++) {
    bits[index] = Number((number >> BigInt((RECOVERY_BYTES - 1 - index) * 8)) & 0xffn);
  }
  return bits;
}

export async function sealRecoveryEnvelope(
  dek: DataKey,
  recoveryKey: string,
  randomness: SealRandomness,
): Promise<Bytes> {
  const bits = parseRecoveryKey(recoveryKey);
  return seal(dek, "recovery", randomness, await recoveryAesKey(bits, randomness.salt));
}

export async function sealPassphraseEnvelope(
  dek: DataKey,
  passphrase: string,
  randomness: SealRandomness,
): Promise<Bytes> {
  const text = checkedPassphrase(passphrase);
  return seal(dek, "passphrase", randomness, await passphraseAesKey(text, randomness.salt));
}

export async function openRecoveryEnvelope(
  envelope: Uint8Array,
  recoveryKey: string,
): Promise<DataKey> {
  const bits = parseRecoveryKey(recoveryKey);
  const parts = readEnvelope(envelope, "recovery");
  return open(parts, await recoveryAesKey(bits, parts.salt));
}

export async function openPassphraseEnvelope(
  envelope: Uint8Array,
  passphrase: string,
): Promise<DataKey> {
  const text = checkedPassphrase(passphrase);
  const parts = readEnvelope(envelope, "passphrase");
  return open(parts, await passphraseAesKey(text, parts.salt));
}

interface EnvelopeParts {
  header: Bytes;
  salt: Bytes;
  nonce: Bytes;
  sealed: Bytes;
}

async function seal(
  dek: DataKey,
  kind: EnvelopeKind,
  { salt, nonce }: SealRandomness,
  key: CryptoKey,
): Promise<Bytes> {
  requireLength("The data key", dek, DEK_BYTES);
  requireLength("The salt", salt, SALT_BYTES);
  requireLength("The nonce", nonce, NONCE_BYTES);
  const header = new Uint8Array([VERSION, KIND_BYTE[kind], ...salt, ...nonce]);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: concat(header, LABEL) },
    key,
    dek,
  );
  return concat(header, new Uint8Array(sealed));
}

async function open({ header, nonce, sealed }: EnvelopeParts, key: CryptoKey): Promise<DataKey> {
  try {
    const dek = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, additionalData: concat(header, LABEL) },
      key,
      sealed,
    );
    return new Uint8Array(dek);
  } catch {
    // A failed tag check is the only way decrypt fails here: never say why.
    throw new EnvelopeOpenError();
  }
}

/** Checks the version first, because a later version may have another layout. */
function readEnvelope(envelope: Uint8Array, expected: EnvelopeKind): EnvelopeParts {
  const version = envelope[0];
  if (version !== undefined && version !== VERSION) {
    throw new EnvelopeFormatError(
      `Unknown envelope version ${version}: this goop reads version ${VERSION}.`,
    );
  }
  if (envelope.length !== ENVELOPE_BYTES) {
    const problem = envelope.length < ENVELOPE_BYTES ? "truncated" : "too long";
    throw new EnvelopeFormatError(
      `The envelope is ${problem}: ${envelope.length} bytes, expected ${ENVELOPE_BYTES}.`,
    );
  }
  const kindByte = envelope[1];
  const kind = (Object.keys(KIND_BYTE) as EnvelopeKind[]).find((k) => KIND_BYTE[k] === kindByte);
  if (kind === undefined) throw new EnvelopeFormatError(`Unknown envelope kind ${kindByte}.`);
  if (kind !== expected) {
    throw new EnvelopeFormatError(
      kind === "passphrase"
        ? "This is a passphrase envelope: open it with the passphrase."
        : "This is a recovery envelope: open it with the recovery key.",
    );
  }
  return {
    header: envelope.slice(0, HEADER_BYTES),
    salt: envelope.slice(2, 2 + SALT_BYTES),
    nonce: envelope.slice(2 + SALT_BYTES, HEADER_BYTES),
    sealed: envelope.slice(HEADER_BYTES),
  };
}

/** A random 160-bit key cannot be guessed, so HKDF needs no slow stretching (S3). */
async function recoveryAesKey(bits: Bytes, salt: Bytes): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveBits"]);
  bits.fill(0);
  const derived = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: RECOVERY_INFO },
    material,
    256,
  );
  return aesKey(new Uint8Array(derived));
}

/** scrypt makes every guess of a passphrase expensive (S4). Async: it runs off the event loop. */
async function passphraseAesKey(passphrase: string, salt: Bytes): Promise<CryptoKey> {
  const derived = await new Promise<Buffer>((resolve, reject) =>
    scrypt(passphrase, salt, 32, SCRYPT, (error, key) => (error ? reject(error) : resolve(key))),
  );
  const raw = new Uint8Array(derived);
  derived.fill(0);
  return aesKey(raw);
}

/** Imports the raw key, which WebCrypto copies, then zeroes the raw bytes. */
async function aesKey(raw: Bytes): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } finally {
    raw.fill(0);
  }
}

/** The same passphrase typed on another system can arrive in another Unicode form. */
function checkedPassphrase(passphrase: string): string {
  if (passphrase.length === 0) throw new KeyInputError("The passphrase is empty.");
  return passphrase.normalize("NFC");
}

function requireLength(name: string, bytes: Uint8Array, length: number): void {
  if (bytes.length !== length) {
    throw new RangeError(`${name} must be ${length} bytes, not ${bytes.length}.`);
  }
}

function concat(first: Uint8Array, second: Uint8Array): Bytes {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return joined;
}
