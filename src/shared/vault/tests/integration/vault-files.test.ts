import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { nodeVaultFiles, VaultFileError } from "@/shared/vault";

const repo = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const linux = process.platform === "linux";

let root = "";
let folder = "";

beforeEach(() => {
  root = join(repo, ".temp", "tests", `vault-files-${crypto.randomUUID()}`);
  folder = join(root, "data");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

test("a new file is written whole, with no temporary file left", async () => {
  const files = nodeVaultFiles(folder);

  await files.write("data-key.recovery", new Uint8Array([1, 2, 3]), { replace: false });

  expect(new Uint8Array(readFileSync(join(folder, "data-key.recovery")))).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  expect(readdirSync(folder)).toEqual(["data-key.recovery"]);
  expect(await files.read("data-key.recovery")).toEqual(new Uint8Array([1, 2, 3]));
  expect(await files.exists("data-key.recovery")).toBe(true);
  expect(files.path("goop.db")).toBe(join(folder, "goop.db"));
});

test.skipIf(!linux)("on Linux the folder is 0700 and the file 0600", async () => {
  mkdirSync(folder, { recursive: true, mode: 0o755 });

  await nodeVaultFiles(folder).write("data-key.os", new Uint8Array([1]), { replace: false });

  expect(statSync(folder).mode & 0o777).toBe(0o700);
  expect(statSync(join(folder, "data-key.os")).mode & 0o777).toBe(0o600);
});

test("without replace, an existing file is refused and kept", async () => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "data-key.os"), "kept");

  const error = await rejection(
    nodeVaultFiles(folder).write("data-key.os", new Uint8Array([1]), { replace: false }),
  );

  expect(error).toBeInstanceOf(VaultFileError);
  expect(error.message).toBe("The vault file data-key.os already exists.");
  expect(readFileSync(join(folder, "data-key.os"), "utf8")).toBe("kept");
  expect(readdirSync(folder)).toEqual(["data-key.os"]);
});

test("with replace, an existing file is replaced whole", async () => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "data-key.os"), "old");

  await nodeVaultFiles(folder).write("data-key.os", new Uint8Array([4, 5]), { replace: true });

  expect(new Uint8Array(readFileSync(join(folder, "data-key.os")))).toEqual(new Uint8Array([4, 5]));
  expect(readdirSync(folder)).toEqual(["data-key.os"]);
  if (linux) expect(statSync(join(folder, "data-key.os")).mode & 0o777).toBe(0o600);
});

test("a missing file reads as undefined, and removing it does nothing", async () => {
  const files = nodeVaultFiles(folder);

  expect(await files.read("data-key.os")).toBeUndefined();
  expect(await files.exists("goop.db")).toBe(false);
  await files.remove("data-key.os");
});

test("an envelope file past 64 KiB is refused before it is read", async () => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "data-key.os"), new Uint8Array(64 * 1024 + 1));

  const error = await rejection(nodeVaultFiles(folder).read("data-key.os"));

  expect(error).toBeInstanceOf(VaultFileError);
  expect(error.message).toBe("The vault file data-key.os is too large.");
});
