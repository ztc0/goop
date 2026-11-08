import { describe, expect, test } from "bun:test";
import { zipMember } from "@scripts/sandbox/model/zip";
import { zipFixture } from "@scripts/sandbox/tests/zip-fixture";

const BINARY = new TextEncoder().encode("binary ".repeat(200));

describe("zipMember", () => {
  test("returns the named file, deflated or stored, and nothing else of the archive", () => {
    const zip = zipFixture([
      { name: "bun-linux-x64/", content: new Uint8Array() },
      { name: "bun-linux-x64/bun", content: BINARY, deflate: true },
      { name: "notes.txt", content: new TextEncoder().encode("stored") },
    ]);

    expect(zipMember(zip, "bun-linux-x64/bun")).toEqual(BINARY);
    expect(zipMember(zip, "notes.txt")).toEqual(new TextEncoder().encode("stored"));
  });

  test("names a missing file instead of guessing another one", () => {
    const zip = zipFixture([{ name: "bun-windows-x64/bun.exe", content: BINARY }]);

    expect(zipMember(zip, "bun-linux-x64/bun")).toEqual({
      error: "the archive has no bun-linux-x64/bun",
    });
  });

  test("refuses bytes that are not a zip archive, or are cut short", () => {
    const zip = zipFixture([{ name: "bun", content: BINARY, deflate: true }]);

    expect(zipMember(new TextEncoder().encode("<html>not found</html>"), "bun")).toEqual({
      error: "not a zip archive",
    });
    expect(zipMember(zip.slice(0, 40), "bun")).toEqual({ error: "not a zip archive" });
  });
});
