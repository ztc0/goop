// The real DPAPI calls through `bun:ffi` (S6). The libraries load on the first call, never at
// import, so importing `@/shared/keystore` on Linux touches no Windows symbol.
import { dlopen, type Pointer, ptr, read, toArrayBuffer } from "bun:ffi";
import type { Bytes } from "@/shared/keys";
import type { DpapiNative } from "../types/dpapi";

// DATA_BLOB on x64: DWORD cbData, 4 bytes of padding, BYTE* pbData.
const BLOB_SIZE = 16;
const DPAPI_ARGS = ["ptr", "ptr", "ptr", "ptr", "ptr", "u32", "ptr"] as const;

function load() {
  const crypt32 = dlopen("crypt32.dll", {
    CryptProtectData: { args: DPAPI_ARGS, returns: "i32" },
    CryptUnprotectData: { args: DPAPI_ARGS, returns: "i32" },
  });
  const kernel32 = dlopen("kernel32.dll", {
    GetLastError: { args: [], returns: "u32" },
    LocalFree: { args: ["ptr"], returns: "ptr" },
  });
  return { ...crypt32.symbols, ...kernel32.symbols };
}

let library: ReturnType<typeof load> | undefined;

/** A DATA_BLOB that points at `bytes`; `bytes` must stay referenced until the call returns. */
function blobOf(bytes: Bytes): Buffer {
  const blob = Buffer.alloc(BLOB_SIZE);
  blob.writeUInt32LE(bytes.length, 0);
  blob.writeBigUInt64LE(BigInt(bytes.length > 0 ? ptr(bytes) : 0), 8);
  return blob;
}

export const dpapiFfi: DpapiNative = {
  call(fn, input, entropy, flags) {
    library ??= load();
    const inputBlob = blobOf(input);
    const entropyBlob = blobOf(entropy);
    const out = Buffer.alloc(BLOB_SIZE);
    // No description (szDataDescr), no reserved value, no prompt struct.
    const ok = library[fn](ptr(inputBlob), null, ptr(entropyBlob), null, null, flags, ptr(out));
    // The blobs hold raw pointers: keep them and their bytes alive until after the call.
    void [inputBlob, entropyBlob, input, entropy];
    // A separate FFI call: in theory Bun could overwrite the code in between (T11 limit).
    if (!ok) return { ok: false, code: library.GetLastError() };
    const length = read.u32(ptr(out), 0);
    const data = read.ptr(ptr(out), 8) as Pointer;
    const free = () => void library?.LocalFree(data);
    const bytes = length > 0 ? new Uint8Array(toArrayBuffer(data, 0, length)) : new Uint8Array(0);
    return { ok: true, output: { bytes, free } };
  },
};
