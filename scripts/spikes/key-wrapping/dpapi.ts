// Wraps a data key with Windows DPAPI, user scope, through bun:ffi on crypt32.dll.
// The key only travels through process memory: never argv, never a file.
import { dlopen, type Pointer, ptr, read, toArrayBuffer } from "bun:ffi";

export const ENTROPY = "goop-dek-v1";
// wincrypt.h: never show a prompt; fail instead.
const CRYPTPROTECT_UI_FORBIDDEN = 0x1;
// DATA_BLOB on x64: DWORD cbData, 4 bytes of padding, BYTE* pbData.
const BLOB_SIZE = 16;

const crypt32 = dlopen("crypt32.dll", {
  CryptProtectData: {
    args: ["ptr", "ptr", "ptr", "ptr", "ptr", "u32", "ptr"],
    returns: "i32",
  },
  CryptUnprotectData: {
    args: ["ptr", "ptr", "ptr", "ptr", "ptr", "u32", "ptr"],
    returns: "i32",
  },
});

const kernel32 = dlopen("kernel32.dll", {
  GetLastError: { args: [], returns: "u32" },
  LocalFree: { args: ["ptr"], returns: "ptr" },
});

/** A DATA_BLOB that points at `bytes`; `bytes` must stay referenced until the call returns. */
function blobOf(bytes: Uint8Array): Buffer {
  const blob = Buffer.alloc(BLOB_SIZE);
  blob.writeUInt32LE(bytes.length, 0);
  blob.writeBigUInt64LE(BigInt(bytes.length > 0 ? ptr(bytes) : 0), 8);
  return blob;
}

function lastError(call: string): Error {
  const code = kernel32.symbols.GetLastError();
  return new Error(`${call} failed: GetLastError 0x${code.toString(16).padStart(8, "0")}`);
}

/** Copies the output DATA_BLOB into JS memory, zeroes it and frees it with LocalFree. */
function takeOutput(out: Buffer): Uint8Array {
  const length = read.u32(ptr(out), 0);
  const data = read.ptr(ptr(out), 8) as Pointer;
  try {
    const view = new Uint8Array(toArrayBuffer(data, 0, length));
    const copy = new Uint8Array(view);
    view.fill(0);
    return copy;
  } finally {
    kernel32.symbols.LocalFree(data);
  }
}

type DpapiCall = typeof crypt32.symbols.CryptProtectData;

function call(
  name: "CryptProtectData" | "CryptUnprotectData",
  data: Uint8Array,
  entropy: string | null,
) {
  const fn: DpapiCall = crypt32.symbols[name];
  const entropyBytes = entropy === null ? null : new TextEncoder().encode(entropy);
  const input = blobOf(data);
  const extra = entropyBytes === null ? null : blobOf(entropyBytes);
  const out = Buffer.alloc(BLOB_SIZE);
  const ok = fn(
    ptr(input),
    null,
    extra && ptr(extra),
    null,
    null,
    CRYPTPROTECT_UI_FORBIDDEN,
    ptr(out),
  );
  if (!ok) throw lastError(name);
  // The blobs hold raw pointers: keep their bytes alive until after the call.
  void [data, entropyBytes];
  return takeOutput(out);
}

export function wrapWithDpapi(key: Uint8Array, entropy: string | null = ENTROPY): Uint8Array {
  return call("CryptProtectData", key, entropy);
}

export function unwrapWithDpapi(blob: Uint8Array, entropy: string | null = ENTROPY): Uint8Array {
  return call("CryptUnprotectData", blob, entropy);
}
