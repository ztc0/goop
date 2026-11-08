import { inflateRawSync } from "node:zlib";

const END_RECORD = 0x06054b50;
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const NOT_A_ZIP = { error: "not a zip archive" };

/**
 * One file of a zip archive, by its exact name, stored or deflated. Only that name is read, so
 * no path in the archive can escape anywhere; the caller checks the archive's sha256 first.
 */
export function zipMember(zip: Uint8Array, name: string): Uint8Array | { error: string } {
  try {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    // The end record is the last 22 bytes, plus a comment of at most 65535 bytes.
    let end = -1;
    for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 65_535); at -= 1) {
      if (view.getUint32(at, true) === END_RECORD) {
        end = at;
        break;
      }
    }
    if (end < 0) return NOT_A_ZIP;
    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    for (let index = 0; index < count; index += 1) {
      if (view.getUint32(at, true) !== CENTRAL_HEADER) return NOT_A_ZIP;
      const method = view.getUint16(at + 10, true);
      const compressed = view.getUint32(at + 20, true);
      const size = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLength = view.getUint16(at + 32, true);
      const local = view.getUint32(at + 42, true);
      const entry = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
      at += 46 + nameLength + extraLength + commentLength;
      if (entry !== name) continue;
      if (view.getUint32(local, true) !== LOCAL_HEADER) return NOT_A_ZIP;
      const start =
        local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      if (start + compressed > zip.length) return NOT_A_ZIP;
      const data = zip.subarray(start, start + compressed);
      if (method !== 0 && method !== 8) return { error: `${name} uses zip method ${method}` };
      const bytes = method === 0 ? data.slice() : new Uint8Array(inflateRawSync(data));
      return bytes.length === size ? bytes : NOT_A_ZIP;
    }
    return { error: `the archive has no ${name}` };
  } catch {
    // A truncated archive reads past its end (RangeError) or fails to inflate.
    return NOT_A_ZIP;
  }
}
