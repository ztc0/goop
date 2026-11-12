import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUN_RELEASES } from "@scripts/sandbox/model/bun-release";

const repo = resolve(import.meta.dir, "..", "..", "..", "..");
const containerfile = readFileSync(join(repo, "scripts", "dev", "Containerfile"), "utf8");
const sandboxContainerfile = readFileSync(
  join(repo, "scripts", "sandbox", "debian", "Containerfile"),
  "utf8",
);

const fromLine = (text: string) => text.split("\n").filter((line) => line.startsWith("FROM "));

// The dev image pins the same base and the same Bun as the sandbox, so the pins never drift.
describe("dev Containerfile", () => {
  test("uses the sandbox's pinned Debian base", () => {
    const sandboxFrom = fromLine(sandboxContainerfile);
    expect(sandboxFrom).toHaveLength(1);
    expect(sandboxFrom[0]).toMatch(/^FROM docker\.io\/library\/debian:trixie@sha256:[0-9a-f]{64}$/);
    expect(fromLine(containerfile)).toEqual(sandboxFrom);
  });

  test("downloads the pinned Linux Bun and checks the zip and the executable", () => {
    const bun = BUN_RELEASES["linux-x64"];
    expect(containerfile).toContain(bun.url);
    expect(containerfile).toContain(`${bun.sha256}  /tmp/bun.zip`);
    expect(containerfile).toContain(`/tmp/bun/${bun.member}`);
    expect(containerfile).toContain(`${bun.binarySha256}  /usr/local/bin/bun`);
    expect(containerfile.match(/sha256sum -c/g)).toHaveLength(2);
  });
});
