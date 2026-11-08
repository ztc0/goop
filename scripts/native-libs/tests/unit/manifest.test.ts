import { describe, expect, test } from "bun:test";
import { manifestText, parseManifest, withEntry } from "@scripts/native-libs/model/manifest";
import type { LibraryEntry } from "@scripts/native-libs/types/native-libs";
import { parseNativeManifest, pinnedLibrary } from "@/shared/vault";

const SHA = "38380e83569117219e66b18175ff937a5ec738de9411444a0819c6327b55593f";
const ENTRY: LibraryEntry = { file: "libsqlite3mc.so", sha256: SHA, sqliteVersion: "3.54.0" };
const text = (value: unknown) => JSON.stringify(value);
const withLinux = (entry: unknown) =>
  text({ version: 1, libraries: { sqlite3mc: { "linux-x64": entry } } });

describe("withEntry and manifestText", () => {
  test("write the shape goop reads, with one entry", () => {
    const written = manifestText(withEntry(undefined, "sqlite3mc", "linux-x64", ENTRY));
    expect(written).toBe(`{
  "version": 1,
  "libraries": {
    "sqlite3mc": {
      "linux-x64": {
        "file": "libsqlite3mc.so",
        "sha256": "${SHA}",
        "sqliteVersion": "3.54.0"
      }
    }
  }
}
`);
  });

  test("the written manifest passes vault/native's parser through @/shared/vault", () => {
    const written = manifestText(withEntry(undefined, "sqlite3mc", "linux-x64", ENTRY));
    const pinned = pinnedLibrary(parseNativeManifest(written), "sqlite3mc", "linux-x64");
    expect(pinned).toEqual({ name: "sqlite3mc", ...ENTRY });
  });

  test("keep the other libraries and platforms, and replace only the one built", () => {
    const windows = { file: "sqlite3mc_x64.dll", sha256: "a".repeat(64), sqliteVersion: "3.54.0" };
    const vec = { file: "vec0.so", sha256: "b".repeat(64) };
    const old = withEntry(
      withEntry(withEntry(undefined, "sqlite3mc", "win32-x64", windows), "sqlite3mc", "linux-x64", {
        ...ENTRY,
        sha256: "c".repeat(64),
      }),
      "sqlite-vec",
      "linux-x64",
      vec,
    );
    expect(withEntry(old, "sqlite3mc", "linux-x64", ENTRY)).toEqual({
      version: 1,
      libraries: {
        sqlite3mc: { "win32-x64": windows, "linux-x64": ENTRY },
        "sqlite-vec": { "linux-x64": vec },
      },
    });
    expect(old.libraries.sqlite3mc?.["linux-x64"]?.sha256).toBe("c".repeat(64));
  });
});

describe("parseManifest", () => {
  test("reads back what manifestText writes, with or without sqliteVersion", () => {
    const manifest = withEntry(
      withEntry(undefined, "sqlite3mc", "linux-x64", ENTRY),
      "sqlite-vec",
      "linux-x64",
      { file: "vec0.so", sha256: SHA },
    );
    expect(parseManifest(manifestText(manifest))).toEqual({ manifest });
  });

  test("refuses anything but the exact shape, naming the field and never its value", () => {
    const cases: [string, string][] = [
      ["{", "is not valid JSON"],
      ["[]", "the top level must be an object"],
      [text({ version: 2, libraries: {} }), "version must be 1"],
      [text({ version: 1, libraries: [] }), "libraries must be an object"],
      [text({ version: 1, libraries: {}, extra: 1 }), "unexpected key extra"],
      [text({ version: 1, libraries: { "Bad name": {} } }), 'library name "Bad name" is invalid'],
      [text({ version: 1, libraries: { sqlite3mc: 1 } }), "libraries.sqlite3mc must be an object"],
      [
        text({ version: 1, libraries: { sqlite3mc: { "darwin-arm64": ENTRY } } }),
        "unknown platform libraries.sqlite3mc.darwin-arm64",
      ],
      [withLinux("x"), "libraries.sqlite3mc.linux-x64 must be an object"],
      [withLinux({ ...ENTRY, path: "/x" }), "unexpected key libraries.sqlite3mc.linux-x64.path"],
      [
        withLinux({ ...ENTRY, file: "../libsqlite3mc.so" }),
        "libraries.sqlite3mc.linux-x64.file must be a plain file name",
      ],
      [
        withLinux({ ...ENTRY, file: ".hidden" }),
        "libraries.sqlite3mc.linux-x64.file must be a plain file name",
      ],
      [
        withLinux({ ...ENTRY, sha256: SHA.toUpperCase() }),
        "libraries.sqlite3mc.linux-x64.sha256 must be 64 lowercase hex characters",
      ],
      [
        withLinux({ ...ENTRY, sqliteVersion: "3.54" }),
        "libraries.sqlite3mc.linux-x64.sqliteVersion must be a version like 3.54.0",
      ],
    ];
    for (const [input, error] of cases) {
      expect(parseManifest(input)).toEqual({ error: `manifest.json ${error}` });
    }
  });
});
