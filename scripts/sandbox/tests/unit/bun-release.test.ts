import { describe, expect, test } from "bun:test";
import {
  BUN_RELEASES,
  BUN_VERSION,
  bunCachePath,
  checkBunZip,
  checkPackageManager,
  MAX_BUN_ZIP_BYTES,
  shasumsUrl,
} from "../../model/bun-release";
import { sandboxPaths } from "../../model/paths";
import { describeOnLinuxHost } from "../linux-host";

const WINDOWS_ZIP = "ce4c17497b2f29712a99d3d53f028de28cd42e3bacb8589599e7f000e49b6405";
const LINUX_ZIP = "36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913";
const ABC = new TextEncoder().encode("abc");
const ABC_SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("the pinned Bun releases", () => {
  test("are Bun 1.4.2 for windows-x64 and linux-x64, from the official GitHub release", () => {
    expect(BUN_VERSION).toBe("1.4.2");
    expect(BUN_RELEASES).toEqual({
      "windows-x64": {
        version: "1.4.2",
        asset: "bun-windows-x64.zip",
        url: "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-windows-x64.zip",
        sha256: WINDOWS_ZIP,
        member: "bun-windows-x64/bun.exe",
        binary: "bun.exe",
        binarySha256: "15277c59ccd6c6c20f8dc9716c2b59c1776320d606b6a8658f70be8799519ca4",
      },
      "linux-x64": {
        version: "1.4.2",
        asset: "bun-linux-x64.zip",
        url: "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64.zip",
        sha256: LINUX_ZIP,
        member: "bun-linux-x64/bun",
        binary: "bun",
        binarySha256: "a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c",
      },
    });
    expect(shasumsUrl("1.4.2")).toBe(
      "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/SHASUMS256.txt",
    );
    expect(MAX_BUN_ZIP_BYTES).toBe(64 * 1024 * 1024);
  });

  test("must match the Bun version package.json pins", () => {
    expect(checkPackageManager('{ "packageManager": "bun@1.4.2" }')).toBeUndefined();
    expect(checkPackageManager('{ "packageManager": "bun@1.4.3" }')).toBe(
      "package.json pins bun@1.4.3, but the sandbox has hashes for Bun 1.4.2 only; pin the new release in scripts/sandbox/model/bun-release.ts.",
    );
    for (const text of ["{}", '{ "packageManager": "npm@10.0.0" }', "not json"]) {
      expect(checkPackageManager(text)).toBe(
        'package.json has no "packageManager": "bun@<version>".',
      );
    }
  });
});

describe("checkBunZip", () => {
  const release = { ...BUN_RELEASES["linux-x64"], sha256: ABC_SHA };
  const shasums = `${"0".repeat(64)}  bun-linux-x64-baseline.zip\n${ABC_SHA}  bun-linux-x64.zip\n`;

  test("passes when the release lists the pinned sha256 and the bytes have it", () => {
    expect(checkBunZip(release, ABC, shasums)).toBeUndefined();
  });

  test("refuses an asset the release does not list", () => {
    expect(checkBunZip(release, ABC, `${ABC_SHA}  bun-linux-x64-baseline.zip\n`)).toBe(
      "SHASUMS256.txt of Bun 1.4.2 does not list bun-linux-x64.zip.",
    );
  });

  test("refuses a changed upstream asset: the published sha256 is not the pinned one", () => {
    const changed = `${"f".repeat(64)}  bun-linux-x64.zip\n`;

    expect(checkBunZip(release, ABC, changed)).toBe(
      `SHASUMS256.txt of Bun 1.4.2 lists ${"f".repeat(64)} for bun-linux-x64.zip, but the pinned sha256 is ${ABC_SHA}; refusing it.`,
    );
  });

  test("refuses bytes that do not have the pinned sha256", () => {
    expect(checkBunZip(release, new TextEncoder().encode("abd"), shasums)).toBe(
      `sha256 mismatch for bun-linux-x64.zip: expected ${ABC_SHA}, got a52d159f262b2c6ddb724a61840befc36eb30c88877a4030b65cbe86298449c9`,
    );
  });
});

describeOnLinuxHost("bunCachePath", () => {
  test("keeps the verified binary under .local/, keyed by version and archive hash", () => {
    const paths = sandboxPaths("/repo");

    expect(bunCachePath(paths, BUN_RELEASES["windows-x64"])).toBe(
      "/repo/.local/cache/sandbox-bun/1.4.2-ce4c17497b2f2971/bun.exe",
    );
    expect(bunCachePath(paths, BUN_RELEASES["linux-x64"])).toBe(
      "/repo/.local/cache/sandbox-bun/1.4.2-36368faef7527875/bun",
    );
  });
});
