import type { Bytes } from "./key-envelope";

export type DpapiFunction = "CryptProtectData" | "CryptUnprotectData";

/** A buffer DPAPI allocated. Its bytes are copied, zeroed, then freed with `LocalFree`. */
export interface DpapiOutput {
  /** A view of DPAPI's own memory, not a copy. */
  bytes: Uint8Array;
  free(): void;
}

export type DpapiResult = { ok: true; output: DpapiOutput } | { ok: false; code: number };

/** The native DPAPI calls, kept thin so every decision is testable with a fake. */
export interface DpapiNative {
  /** One call in user scope, with no description; a failure carries its `GetLastError` code. */
  call(fn: DpapiFunction, input: Bytes, entropy: Bytes, flags: number): DpapiResult;
}
