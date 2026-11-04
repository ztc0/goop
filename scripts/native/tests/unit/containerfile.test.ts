import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APT_SNAPSHOT, TOOLCHAIN } from "../../model/inputs";

const scripts = join(import.meta.dir, "..", "..", "..");
const read = (path: string) => readFileSync(join(scripts, path), "utf8");
const fromLine = (text: string) => text.split("\n").find((line) => line.startsWith("FROM "));

describe("the build image (S8)", () => {
  const containerfile = read("native/linux/Containerfile");

  test("starts from the same pinned Debian image as the sandbox", () => {
    const sandbox = fromLine(read("sandbox/debian/Containerfile"));
    expect(sandbox).toMatch(/^FROM docker\.io\/library\/debian:trixie@sha256:[0-9a-f]{64}$/);
    expect(fromLine(containerfile)).toBe(sandbox);
  });

  test("installs from the pinned Debian snapshot", () => {
    expect(APT_SNAPSHOT).toBe("20261027T000000Z");
    expect(containerfile).toContain(
      `http://snapshot.debian.org/archive/debian/${APT_SNAPSHOT} trixie main`,
    );
    expect(containerfile).toContain(
      `http://snapshot.debian.org/archive/debian-security/${APT_SNAPSHOT} trixie-security main`,
    );
  });

  test("installs every pinned package at its pinned version", () => {
    for (const { name, version } of TOOLCHAIN) {
      expect(containerfile).toContain(` ${name}=${version}`);
    }
  });
});
