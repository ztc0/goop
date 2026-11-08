// The Windows OS envelope (S6): DPAPI in user scope seals the data key for this Windows user.
// The data key goes straight to crypt32.dll in process memory: never argv, a file or the
// environment. Every buffer DPAPI returns is copied, zeroed and freed.

import type { Bytes, DataKey } from "@/shared/vault/keys";
import { dpapiFfi } from "@/shared/vault/keystore/adapters/dpapi-ffi";
import {
  CRYPTPROTECT_UI_FORBIDDEN,
  classifyDpapiError,
  DPAPI_ENTROPY,
  DPAPI_RETRY_WAITS_MS,
  hexCode,
} from "@/shared/vault/keystore/model/dpapi";
import {
  OsEnvelopeOpenError,
  OsEnvelopeSealError,
  OsEnvelopeUnavailableError,
} from "@/shared/vault/keystore/model/os-key-envelope";
import type { DpapiFunction, DpapiNative, DpapiOutput } from "@/shared/vault/keystore/types/dpapi";
import type {
  OsEnvelopeAvailability,
  OsEnvelopeUnavailable,
  OsKeyEnvelope,
} from "@/shared/vault/keystore/types/os-key-envelope";

/** A sealed 32-byte key is a few hundred bytes; more is refused before DPAPI sees it. */
const SEALED_LIMIT = 4096;
const DEK_BYTES = 32;
const ENTROPY = new TextEncoder().encode(DPAPI_ENTROPY);

const BUSY: OsEnvelopeUnavailable = {
  available: false,
  reason: "busy",
  message:
    "The Windows key store (DPAPI) did not answer for about a minute, so goop will try again later. The data key is not lost.",
};

export interface DpapiOptions {
  platform?: string;
  /** The native calls. Tests pass a fake; the default loads crypt32.dll on first use. */
  native?: DpapiNative;
  /** Waits between retries. Tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
}

/** Copies DPAPI's buffer into JS memory, then zeroes and frees it, also when copying fails. */
function take(output: DpapiOutput): Bytes {
  try {
    return new Uint8Array(output.bytes);
  } finally {
    output.bytes.fill(0);
    output.free();
  }
}

export function dpapiEnvelope(options: DpapiOptions = {}): OsKeyEnvelope {
  const platform = options.platform ?? process.platform;
  const native = options.native ?? dpapiFfi;
  const sleep = options.sleep ?? Bun.sleep;

  const unsupported: OsEnvelopeUnavailable | undefined =
    platform === "win32"
      ? undefined
      : {
          available: false,
          reason: "unsupported-platform",
          message: `DPAPI needs Windows, and this system is ${platform}.`,
        };

  /** One DPAPI call, retried while DPAPI is busy and with each wait of the schedule. */
  async function call(fn: DpapiFunction, input: Bytes): Promise<Bytes> {
    if (unsupported) throw new OsEnvelopeUnavailableError(unsupported);
    const action = fn === "CryptProtectData" ? "protect" : "unprotect";
    for (let attempt = 0; ; attempt++) {
      const result = native.call(fn, input, ENTROPY, CRYPTPROTECT_UI_FORBIDDEN);
      if (result.ok) return take(result.output);
      const failure = classifyDpapiError(action, result.code);
      if (failure === "open-failed") throw new OsEnvelopeOpenError();
      if (failure === "seal-failed") {
        throw new OsEnvelopeSealError(`${fn} failed with ${hexCode(result.code)}`);
      }
      const wait = DPAPI_RETRY_WAITS_MS[attempt];
      if (wait === undefined) throw new OsEnvelopeUnavailableError(BUSY);
      await sleep(wait);
    }
  }

  return {
    async availability(): Promise<OsEnvelopeAvailability> {
      return unsupported ?? { available: true };
    },

    seal(dek: DataKey): Promise<Bytes> {
      return call("CryptProtectData", dek);
    },

    async open(sealed: Bytes): Promise<DataKey> {
      if (unsupported) throw new OsEnvelopeUnavailableError(unsupported);
      if (sealed.length === 0 || sealed.length > SEALED_LIMIT) throw new OsEnvelopeOpenError();
      const dek = await call("CryptUnprotectData", sealed);
      if (dek.length === DEK_BYTES) return dek;
      dek.fill(0);
      throw new OsEnvelopeOpenError();
    },
  };
}
