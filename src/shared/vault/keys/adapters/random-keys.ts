// The only place the key code reads the operating system's random generator (S1-S4).
// Every seal here draws a fresh salt and nonce, so no caller can reuse a nonce.
import {
  formatRecoveryKey,
  sealPassphraseEnvelope,
  sealRecoveryEnvelope,
} from "@/shared/vault/keys/model/key-envelope";
import type { Bytes, DataKey, SealRandomness } from "@/shared/vault/keys/types/key-envelope";

const random = (length: number): Bytes => crypto.getRandomValues(new Uint8Array(length));
const freshRandomness = (): SealRandomness => ({ salt: random(16), nonce: random(12) });

/** A new random 256-bit data key. */
export function newDataKey(): DataKey {
  return random(32);
}

/** A new random 160-bit recovery key, as shown to the user once at setup. */
export function newRecoveryKey(): string {
  return formatRecoveryKey(random(20));
}

export function sealWithRecoveryKey(dek: DataKey, recoveryKey: string): Promise<Bytes> {
  return sealRecoveryEnvelope(dek, recoveryKey, freshRandomness());
}

export function sealWithPassphrase(dek: DataKey, passphrase: string): Promise<Bytes> {
  return sealPassphraseEnvelope(dek, passphrase, freshRandomness());
}
