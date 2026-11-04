import { describe, expect, test } from "bun:test";
import { type Bytes, newDataKey } from "@/shared/keys";
import {
  dpapiEnvelope,
  OsEnvelopeOpenError,
  OsEnvelopeSealError,
  type OsEnvelopeUnavailable,
  OsEnvelopeUnavailableError,
} from "@/shared/keystore";
import type { DpapiFunction, DpapiNative, DpapiResult } from "../../types/dpapi";

const OPEN_FAILED =
  "The OS key envelope could not be opened: it was changed, or it belongs to another user, machine or name.";
const BUSY =
  "The Windows key store (DPAPI) did not answer for about a minute, so goop will try again later. The data key is not lost.";
const ENTROPY = new TextEncoder().encode("goop-dek-v1");
const WAITS = [1000, 2000, 4000, 8000, 16000, 16000];

interface Call {
  fn: DpapiFunction;
  input: Uint8Array;
  entropy: Uint8Array;
  flags: number;
}

interface Output {
  bytes: Uint8Array;
  freed: number;
}

/**
 * An in-memory DPAPI: a blob is the input behind a 4-byte tag, and it opens only when it was
 * issued here with the same entropy, like the real one. `failures` are GetLastError codes
 * returned, in order, before any call succeeds.
 */
function fakeDpapi(options: { failures?: number[]; openedLength?: number } = {}) {
  const failures = [...(options.failures ?? [])];
  const calls: Call[] = [];
  const outputs: Output[] = [];
  const issued = new Map<string, string>();
  const key = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

  function output(bytes: Uint8Array): DpapiResult {
    const record: Output = { bytes, freed: 0 };
    outputs.push(record);
    return {
      ok: true,
      output: {
        bytes,
        free: () => {
          record.freed += 1;
        },
      },
    };
  }

  const native: DpapiNative = {
    call(fn, input, entropy, flags) {
      calls.push({ fn, input: new Uint8Array(input), entropy: new Uint8Array(entropy), flags });
      const code = failures.shift();
      if (code !== undefined) return { ok: false, code };
      if (fn === "CryptProtectData") {
        const blob = new Uint8Array([0xd0, 0x8c, 0x9d, 0xdf, ...input]);
        issued.set(key(blob), key(entropy));
        return output(blob);
      }
      if (issued.get(key(input)) !== key(entropy)) return { ok: false, code: 0xd };
      const opened = input.slice(4);
      return output(opened.slice(0, options.openedLength ?? opened.length));
    },
  };
  return { native, calls, outputs, failures };
}

function envelope(fake: ReturnType<typeof fakeDpapi>, platform = "win32") {
  const waits: number[] = [];
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  return { envelope: dpapiEnvelope({ platform, native: fake.native, sleep }), waits };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

/** The secret in every form a leak could take: raw text, hex and base64. */
function expectAbsent(text: string, ...secrets: Bytes[]) {
  for (const secret of secrets) {
    for (const encoding of ["latin1", "hex", "base64"] as const) {
      expect(text.includes(Buffer.from(secret).toString(encoding))).toBe(false);
    }
  }
}

describe("DPAPI OS envelope", () => {
  test("seal and open round trip, with the goop entropy and no prompt", async () => {
    const fake = fakeDpapi();
    const { envelope: dpapi, waits } = envelope(fake);
    const dek = newDataKey();

    const sealed = await dpapi.seal(dek);
    const opened = await dpapi.open(sealed);

    expect(opened).toEqual(dek);
    expect(opened).not.toBe(fake.outputs[1]?.bytes);
    expect(fake.calls.map(({ fn, input, entropy, flags }) => [fn, input, entropy, flags])).toEqual([
      ["CryptProtectData", dek, ENTROPY, 0x1],
      ["CryptUnprotectData", sealed, ENTROPY, 0x1],
    ]);
    expect(waits).toEqual([]);
  });

  test("every DPAPI output buffer is zeroed and freed once after it is copied", async () => {
    const fake = fakeDpapi();
    const { envelope: dpapi } = envelope(fake);

    await dpapi.open(await dpapi.seal(newDataKey()));

    expect(fake.outputs).toHaveLength(2);
    for (const output of fake.outputs) {
      expect(output.bytes.every((byte) => byte === 0)).toBe(true);
      expect(output.freed).toBe(1);
    }
  });

  test("an opened value that is not 32 bytes is the one error, its buffer zeroed and freed", async () => {
    const fake = fakeDpapi({ openedLength: 31 });
    const { envelope: dpapi } = envelope(fake);
    const sealed = await dpapi.seal(newDataKey());

    const error = await rejection(dpapi.open(sealed));

    expect(error).toBeInstanceOf(OsEnvelopeOpenError);
    expect(error.message).toBe(OPEN_FAILED);
    expect(fake.outputs[1]?.bytes.every((byte) => byte === 0)).toBe(true);
    expect(fake.outputs[1]?.freed).toBe(1);
  });

  test("a tampered blob is the one open error, without any retry", async () => {
    const fake = fakeDpapi();
    const { envelope: dpapi, waits } = envelope(fake);
    const sealed = await dpapi.seal(newDataKey());
    const tampered = new Uint8Array(sealed);
    tampered[6] = (tampered[6] ?? 0) ^ 0x01;

    const error = await rejection(dpapi.open(tampered));

    expect(error).toBeInstanceOf(OsEnvelopeOpenError);
    expect(error.message).toBe(OPEN_FAILED);
    expect(fake.calls).toHaveLength(2);
    expect(waits).toEqual([]);
  });

  test("an empty or oversized blob is the one open error, never sent to DPAPI", async () => {
    const fake = fakeDpapi();
    const { envelope: dpapi } = envelope(fake);

    expect(await rejection(dpapi.open(new Uint8Array(0)))).toBeInstanceOf(OsEnvelopeOpenError);
    expect(await rejection(dpapi.open(new Uint8Array(4097)))).toBeInstanceOf(OsEnvelopeOpenError);
    expect(fake.calls).toEqual([]);
  });

  test("a failed seal names only the hex code", async () => {
    const fake = fakeDpapi({ failures: [0x8] });
    const { envelope: dpapi, waits } = envelope(fake);

    const error = await rejection(dpapi.seal(newDataKey()));

    expect(error).toBeInstanceOf(OsEnvelopeSealError);
    expect(error.message).toBe(
      "The OS key store could not seal the data key: CryptProtectData failed with 0x00000008.",
    );
    expect(waits).toEqual([]);
  });
});

describe("a busy DPAPI is retried, never a lost key", () => {
  test.each([
    ["seal", "ERROR_ACCESS_DENIED", 0x5],
    ["open", "NTE_BAD_KEY_STATE", 0x8009000b],
  ])("%s retries %s with growing waits, then succeeds", async (action, _, code) => {
    const fake = fakeDpapi();
    const { envelope: dpapi, waits } = envelope(fake);
    const dek = newDataKey();
    const sealed = await dpapi.seal(dek);
    fake.calls.length = 0;
    fake.failures.push(code, code, code);

    if (action === "seal") expect(await dpapi.seal(dek)).toEqual(sealed);
    else expect(await dpapi.open(sealed)).toEqual(dek);

    expect(waits).toEqual([1000, 2000, 4000]);
    expect(fake.calls).toHaveLength(4);
  });

  test.each([
    ["seal", 0x5],
    ["open", 0x8009000b],
  ])("%s still busy after every wait is unavailable, not a failed open", async (action, code) => {
    const fake = fakeDpapi({ failures: Array(WAITS.length + 1).fill(code) });
    const { envelope: dpapi, waits } = envelope(fake);
    const blob = new Uint8Array([1, 2, 3]);

    const error = await rejection(action === "seal" ? dpapi.seal(newDataKey()) : dpapi.open(blob));

    expect(error).toBeInstanceOf(OsEnvelopeUnavailableError);
    expect((error as OsEnvelopeUnavailableError).reason).toBe("busy");
    expect(error.message).toBe(BUSY);
    expect(waits).toEqual(WAITS);
    expect(fake.calls).toHaveLength(WAITS.length + 1);
  });

  test("ERROR_INVALID_DATA on open is the one open error at once", async () => {
    const fake = fakeDpapi({ failures: [0xd, 0x5] });
    const { envelope: dpapi, waits } = envelope(fake);

    expect(await rejection(dpapi.open(new Uint8Array([1, 2, 3])))).toBeInstanceOf(
      OsEnvelopeOpenError,
    );
    expect(fake.calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });
});

describe("DPAPI availability", () => {
  test("Windows is available", async () => {
    expect(await envelope(fakeDpapi()).envelope.availability()).toEqual({ available: true });
  });

  test("another platform is unsupported, and DPAPI is never called", async () => {
    const fake = fakeDpapi();
    const { envelope: dpapi } = envelope(fake, "linux");
    const unavailable: OsEnvelopeUnavailable = {
      available: false,
      reason: "unsupported-platform",
      message: "DPAPI needs Windows, and this system is linux.",
    };

    expect(await dpapi.availability()).toEqual(unavailable);
    for (const attempt of [dpapi.seal(newDataKey()), dpapi.open(new Uint8Array([1]))]) {
      const error = await rejection(attempt);
      expect(error).toBeInstanceOf(OsEnvelopeUnavailableError);
      expect(error.message).toBe(unavailable.message);
    }
    expect(fake.calls).toEqual([]);
  });

  test("the default binding off Windows never loads crypt32", async () => {
    const dpapi = dpapiEnvelope({ platform: "linux" });

    expect(await dpapi.availability()).toMatchObject({ reason: "unsupported-platform" });
    expect(await rejection(dpapi.seal(newDataKey()))).toBeInstanceOf(OsEnvelopeUnavailableError);
  });
});

test("no error message holds the data key, the blob or the entropy", async () => {
  const dek = newDataKey();
  const fake = fakeDpapi({ openedLength: 31 });
  const { envelope: dpapi } = envelope(fake);
  const sealed = await dpapi.seal(dek);
  const busy = Array<number>(WAITS.length + 1);
  const attempts: [number[], () => Promise<unknown>][] = [
    [[0x8], () => dpapi.seal(dek)],
    [busy.fill(0x5), () => dpapi.seal(dek)],
    [[], () => dpapi.open(sealed)],
    [[0xd], () => dpapi.open(sealed)],
    [[...busy.fill(0x8009000b)], () => dpapi.open(sealed)],
  ];

  for (const [failures, attempt] of attempts) {
    fake.failures.push(...failures);
    expectAbsent((await rejection(attempt())).message, dek, sealed, ENTROPY);
  }
});
