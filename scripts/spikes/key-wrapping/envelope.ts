// Wraps a data key with a key derived from a recovery key (HKDF) or a passphrase (scrypt),
// using AES-256-GCM from WebCrypto. The recovery key has 160 random bits, so it needs no
// stretching; a passphrase is guessable, so scrypt makes every guess expensive.
import { scrypt } from "node:crypto";

// Crockford base32: no I, L, O or U, so a key read aloud or typed by hand is unambiguous.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const AAD = new TextEncoder().encode("goop-dek-v1");
export const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

export interface Envelope {
  kdf: "hkdf-sha256" | "scrypt";
  salt: string;
  iv: string;
  ciphertext: string;
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
/** WebCrypto accepts only bytes backed by a plain ArrayBuffer. */
export type Bytes = Uint8Array<ArrayBuffer>;

const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));

/** 160 random bits as 32 base32 characters in eight groups of four: XXXX-XXXX-... */
export function newRecoveryKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let text = "";
  for (let index = 31; index >= 0; index--)
    text += ALPHABET[Number((bits >> BigInt(index * 5)) & 31n)];
  return text.match(/.{4}/g)?.join("-") ?? text;
}

/** Accepts lowercase, spaces and dashes, and the letters people confuse with digits. */
export function normalizeRecoveryKey(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

async function aesKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function recoveryKek(recoveryKey: string, salt: Bytes): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalizeRecoveryKey(recoveryKey)),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: AAD },
    material,
    256,
  );
  return aesKey(new Uint8Array(bits));
}

async function passphraseKek(passphrase: string, salt: Bytes): Promise<CryptoKey> {
  const raw = await new Promise<Buffer>((resolve, reject) =>
    scrypt(passphrase.normalize("NFC"), salt, 32, SCRYPT, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
  return aesKey(new Uint8Array(raw));
}

async function seal(key: Bytes, kek: CryptoKey, kdf: Envelope["kdf"], salt: Bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: AAD },
    kek,
    key,
  );
  return {
    kdf,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

async function open(envelope: Envelope, kek: CryptoKey): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(envelope.iv), additionalData: AAD },
    kek,
    fromBase64(envelope.ciphertext),
  );
  return new Uint8Array(plain);
}

export async function wrapWithRecoveryKey(key: Bytes, recoveryKey: string): Promise<Envelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return seal(key, await recoveryKek(recoveryKey, salt), "hkdf-sha256", salt);
}

export async function unwrapWithRecoveryKey(envelope: Envelope, recoveryKey: string) {
  return open(envelope, await recoveryKek(recoveryKey, fromBase64(envelope.salt)));
}

export async function wrapWithPassphrase(key: Bytes, passphrase: string): Promise<Envelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return seal(key, await passphraseKek(passphrase, salt), "scrypt", salt);
}

export async function unwrapWithPassphrase(envelope: Envelope, passphrase: string) {
  return open(envelope, await passphraseKek(passphrase, fromBase64(envelope.salt)));
}
