import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { nodeFileStore } from "../../adapters/file-store";

const repo = resolve(import.meta.dir, "..", "..", "..", "..");
let fixture: string;

beforeEach(() => {
  fixture = join(repo, ".temp", "tests", `sandbox-file-store-${crypto.randomUUID()}`);
  mkdirSync(fixture, { recursive: true });
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe("nodeFileStore.writeBytes", () => {
  test("writes the bytes and leaves no temporary file behind", () => {
    const target = join(fixture, "bun");

    nodeFileStore.writeBytes(target, new Uint8Array([1, 2, 3]));

    expect([...readFileSync(target)]).toEqual([1, 2, 3]);
    expect(readdirSync(fixture)).toEqual(["bun"]);
  });

  test("never takes over the temporary file of another writer of the same target", () => {
    const target = join(fixture, "bun");
    const otherWriter = `${target}.part`;
    writeFileSync(otherWriter, "half written by another process");

    nodeFileStore.writeBytes(target, new Uint8Array([1, 2, 3]));

    expect([...readFileSync(target)]).toEqual([1, 2, 3]);
    expect(readFileSync(otherWriter, "utf8")).toBe("half written by another process");
  });
});
