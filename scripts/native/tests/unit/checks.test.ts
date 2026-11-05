import { describe, expect, test } from "bun:test";
import { sha256Hex } from "../../../shared/download";
import {
  checkArchive,
  checkToolchain,
  MAX_ARCHIVE_BYTES,
  sqliteVersionOf,
} from "../../model/checks";
import { SQLITE3MC_ARCHIVE } from "../../model/inputs";

const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("input checks (S8)", () => {
  test("sha256 of bytes, as lowercase hex", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(ABC);
  });

  test("the archive passes only with its pinned sha256", () => {
    const bytes = new TextEncoder().encode("abc");
    expect(checkArchive({ ...SQLITE3MC_ARCHIVE, sha256: ABC }, bytes)).toBeUndefined();
    expect(checkArchive(SQLITE3MC_ARCHIVE, bytes)).toBe(
      `sha256 mismatch for sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip: expected 3f25af603566a23c821d8e581778b5ece2a541d2435776de57b8d845c176815a, got ${ABC}`,
    );
  });

  test("an archive is at most 16 MiB", () => {
    expect(MAX_ARCHIVE_BYTES).toBe(16 * 1024 * 1024);
  });

  test("reads the version the amalgamation declares", () => {
    const source =
      '/* x */\n#define SQLITE_VERSION        "3.54.0"\n#define SQLITE_VERSION "9.9.9"\n';
    expect(sqliteVersionOf(source)).toBe("3.54.0");
    expect(sqliteVersionOf('#define SQLITE_VERSION_NUMBER 3054000\n// "3.54.0"')).toBeUndefined();
  });

  test("the toolchain matches the pins, package by package", () => {
    const listed = [
      "gcc-14 14.2.0-19",
      "cpp-14 14.2.0-19",
      "libgcc-14-dev 14.2.0-19",
      "binutils 2.44-3",
      "binutils-x86-64-linux-gnu 2.44-3",
      "libc6-dev 2.41-12+deb13u4",
      "unzip 6.0-29+deb13u1",
      "",
    ].join("\n");
    expect(checkToolchain(listed)).toEqual([]);
    const changed = listed
      .replace("gcc-14 14.2.0-19", "gcc-14 14.2.0-20")
      .replace("unzip 6.0-29+deb13u1\n", "");
    expect(checkToolchain(changed)).toEqual([
      "gcc-14 is 14.2.0-20, expected 14.2.0-19",
      "unzip is not installed, expected 6.0-29+deb13u1",
    ]);
  });
});
