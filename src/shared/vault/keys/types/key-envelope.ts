/** Bytes backed by a plain ArrayBuffer, the only kind WebCrypto accepts. */
export type Bytes = Uint8Array<ArrayBuffer>;

/** The random 256-bit data key (S1). It lives only in memory; on disk only inside envelopes. */
export type DataKey = Bytes;

/** What wraps the data key inside an envelope (S3, S4). */
export type EnvelopeKind = "recovery" | "passphrase";

/** The random values of one seal. Each seal needs fresh ones: a nonce is never reused. */
export interface SealRandomness {
  /** 16 bytes, the salt of the key derivation. */
  salt: Bytes;
  /** 12 bytes, the AES-GCM nonce. */
  nonce: Bytes;
}
