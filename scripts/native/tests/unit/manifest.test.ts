import { describe, expect, test } from "bun:test";
import { buildManifest, manifestText, parseManifest } from "../../model/manifest";

const SHA = "5ed60d03de21885795e111d82b71f0f667ac8e00059eec10cce305d05caf6aad";
const valid = () => buildManifest(SHA);

describe("the native manifest (S8)", () => {
  test("has the exact shape goop embeds", () => {
    expect(valid()).toEqual({
      version: 1,
      libraries: {
        sqlite3mc: {
          "linux-x64": { file: "libsqlite3mc.so", sha256: SHA, sqliteVersion: "3.54.0" },
        },
      },
    });
    expect(manifestText(valid())).toBe(
      `{\n  "version": 1,\n  "libraries": {\n    "sqlite3mc": {\n      "linux-x64": {\n        "file": "libsqlite3mc.so",\n        "sha256": "${SHA}",\n        "sqliteVersion": "3.54.0"\n      }\n    }\n  }\n}\n`,
    );
  });

  test("reads back what it writes", () => {
    expect(parseManifest(manifestText(valid()))).toEqual({ manifest: valid() });
  });

  test("refuses another shape, naming the field and never quoting its value", () => {
    const entry = { file: "libsqlite3mc.so", sha256: SHA, sqliteVersion: "3.54.0" };
    const cases: [unknown, string][] = [
      [{ version: 2, libraries: { sqlite3mc: { "linux-x64": entry } } }, "version must be 1"],
      [{ version: 1 }, "libraries must be an object"],
      [{ version: 1, libraries: {} }, "libraries.sqlite3mc must be an object"],
      [
        { version: 1, libraries: { sqlite3mc: {} } },
        "libraries.sqlite3mc.linux-x64 must be an object",
      ],
      [
        { version: 1, libraries: { sqlite3mc: { "linux-x64": { ...entry, sha256: "ABC" } } } },
        "libraries.sqlite3mc.linux-x64.sha256 must be 64 lowercase hex characters",
      ],
      [
        { version: 1, libraries: { sqlite3mc: { "linux-x64": { ...entry, file: "../x.so" } } } },
        "libraries.sqlite3mc.linux-x64.file must be a plain file name",
      ],
      [
        { version: 1, libraries: { sqlite3mc: { "linux-x64": { ...entry, sqliteVersion: 3 } } } },
        "libraries.sqlite3mc.linux-x64.sqliteVersion must be a version like 3.54.0",
      ],
      [
        { version: 1, libraries: { sqlite3mc: { "linux-x64": entry } }, extra: true },
        "unexpected key extra",
      ],
      [
        { version: 1, libraries: { sqlite3mc: { "linux-x64": entry, "windows-x64": entry } } },
        "unexpected key libraries.sqlite3mc.windows-x64",
      ],
      [
        { version: 1, libraries: { sqlite3mc: { "linux-x64": { ...entry, size: 1 } } } },
        "unexpected key libraries.sqlite3mc.linux-x64.size",
      ],
    ];
    for (const [value, error] of cases) {
      expect(parseManifest(JSON.stringify(value))).toEqual({ error: `manifest.json: ${error}` });
    }
    expect(parseManifest("{")).toEqual({ error: "manifest.json is not valid JSON" });
    expect(parseManifest("[]")).toEqual({
      error: "manifest.json: the top level must be an object",
    });
  });
});
