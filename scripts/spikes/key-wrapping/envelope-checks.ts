// T11 checks shared by both platforms: the recovery key and the passphrase fallback.
import {
  type Bytes,
  type Envelope,
  newRecoveryKey,
  SCRYPT,
  unwrapWithPassphrase,
  unwrapWithRecoveryKey,
  wrapWithPassphrase,
  wrapWithRecoveryKey,
} from "./envelope";
import { expect, type Report, sameBytes } from "./report";

// Spike-only passphrases. Never a real secret.
const PASSPHRASE = "insecure spike passphrase, do not use";
const WRONG_PASSPHRASE = "insecure wrong passphrase";

async function rejects(body: () => Promise<unknown>): Promise<boolean> {
  try {
    await body();
    return false;
  } catch {
    return true;
  }
}

function tampered(envelope: Envelope): Envelope {
  const bytes = Buffer.from(envelope.ciphertext, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return { ...envelope, ciphertext: bytes.toString("base64") };
}

export async function runEnvelopeChecks(report: Report, key: Bytes): Promise<void> {
  await report.check("r recovery key", async () => {
    const recoveryKey = newRecoveryKey();
    expect(
      /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/.test(recoveryKey),
      `format ${recoveryKey}`,
    );
    const envelope = await wrapWithRecoveryKey(key, recoveryKey);
    expect(
      sameBytes(await unwrapWithRecoveryKey(envelope, recoveryKey), key),
      "round trip differs",
    );
    const typed = recoveryKey.toLowerCase().replace(/-/g, " ").replace(/0/g, "o");
    expect(sameBytes(await unwrapWithRecoveryKey(envelope, typed), key), "typed form rejected");
    expect(
      await rejects(() => unwrapWithRecoveryKey(envelope, newRecoveryKey())),
      "wrong key opened it",
    );
    expect(
      await rejects(() => unwrapWithRecoveryKey(tampered(envelope), recoveryKey)),
      "tamper opened it",
    );
    return "round trip, typed form (lowercase, spaces, o for 0) accepted; wrong key and tamper rejected";
  });

  await report.check("p passphrase fallback", async () => {
    const started = performance.now();
    const envelope = await wrapWithPassphrase(key, PASSPHRASE);
    const wrapMs = Math.round(performance.now() - started);
    expect(sameBytes(await unwrapWithPassphrase(envelope, PASSPHRASE), key), "round trip differs");
    expect(
      await rejects(() => unwrapWithPassphrase(envelope, WRONG_PASSPHRASE)),
      "wrong passphrase opened it",
    );
    expect(
      await rejects(() => unwrapWithPassphrase(tampered(envelope), PASSPHRASE)),
      "tamper opened it",
    );
    return `scrypt N=2^${Math.log2(SCRYPT.N)} r=${SCRYPT.r} p=${SCRYPT.p}: ${wrapMs} ms per derivation; wrong passphrase and tamper rejected`;
  });
}
