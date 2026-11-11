import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensurePrivateFolder } from "@/shared/dev";

const repo = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const created: string[] = [];
const scratch = () => {
  const folder = join(repo, ".temp", "tests", `private-folder-${crypto.randomUUID()}`);
  mkdirSync(folder, { recursive: true });
  created.push(folder);
  return folder;
};
const mode = (path: string) => statSync(path).mode & 0o777;

afterEach(() => {
  for (const folder of created.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("ensurePrivateFolder", () => {
  test("a symbolic link spelled with a trailing separator is left unchanged, and so is its target", () => {
    const parent = scratch();
    const target = join(parent, "target");
    mkdirSync(target);
    chmodSync(target, 0o755);
    const link = join(parent, "run");
    symlinkSync(target, link);

    for (const folder of [`${link}/`, `${link}//`]) ensurePrivateFolder(folder);

    expect(mode(target)).toBe(0o755);
  });

  test("a folder of ours spelled with a trailing separator is still tightened to 0700", () => {
    const folder = join(scratch(), "run");
    mkdirSync(folder);
    chmodSync(folder, 0o755);

    ensurePrivateFolder(`${folder}/`);

    expect(mode(folder)).toBe(0o700);
  });
});
