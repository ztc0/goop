import { describe, expect, test } from "bun:test";
import { noOsKeyEnvelope, OsEnvelopeUnavailableError } from "@/shared/vault/keystore";

const REASON = "goop runs from source or with GOOP_HOME, so it never uses the OS key store.";

describe("noOsKeyEnvelope (goop S25)", () => {
  test("is never available, so the data key is sealed with the passphrase", async () => {
    expect(await noOsKeyEnvelope(REASON).availability()).toEqual({
      available: false,
      reason: "turned-off",
      message: REASON,
    });
  });

  test("never seals or opens anything", async () => {
    const envelope = noOsKeyEnvelope(REASON);
    for (const call of [envelope.seal(new Uint8Array(32)), envelope.open(new Uint8Array(8))]) {
      const error = await call.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(OsEnvelopeUnavailableError);
      expect((error as OsEnvelopeUnavailableError).reason).toBe("turned-off");
      expect((error as Error).message).toBe(REASON);
    }
  });
});
