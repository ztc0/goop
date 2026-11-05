import { sha256Mismatch } from "../../shared/download";
import type { PinnedArchive } from "../types/native-build";
import { TOOLCHAIN } from "./inputs";

/** The release archive is about 4 MB; anything far larger is refused while downloading. */
export const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;

/** Undefined when the bytes have the pinned sha256, else the error to show. */
export function checkArchive(archive: PinnedArchive, bytes: Uint8Array): string | undefined {
  return sha256Mismatch(archive.name, archive.sha256, bytes);
}

/** The first `#define SQLITE_VERSION "x.y.z"` of the amalgamation. */
export function sqliteVersionOf(source: string): string | undefined {
  return /^#define SQLITE_VERSION\s+"([^"]+)"/m.exec(source)?.[1];
}

/** Reads `dpkg-query` lines (`name version`) and names every package that differs from its pin. */
export function checkToolchain(listed: string): string[] {
  const installed = new Map(
    listed
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const [name = "", version = ""] = line.trim().split(/\s+/);
        return [name, version] as const;
      }),
  );
  return TOOLCHAIN.flatMap(({ name, version }) => {
    const found = installed.get(name);
    if (found === undefined) return [`${name} is not installed, expected ${version}`];
    return found === version ? [] : [`${name} is ${found}, expected ${version}`];
  });
}
