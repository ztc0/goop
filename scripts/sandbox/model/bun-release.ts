import { join } from "node:path";
import { sha256Mismatch } from "../../shared/download";
import type { BunTarget, PinnedBun, SandboxPaths } from "../types/sandbox";

/** The Bun that `package.json` pins (`packageManager`); the sandbox suite runs with it (T8). */
export const BUN_VERSION = "1.4.2";

/** A Bun release zip is about 40 MB; anything far larger is refused while downloading. */
export const MAX_BUN_ZIP_BYTES = 64 * 1024 * 1024;
export const MAX_SHASUMS_BYTES = 64 * 1024;

const RELEASES_URL = "https://github.com/oven-sh/bun/releases/download";

/**
 * The Bun builds the sandboxes run, one per target, pinned by the sha256 that the release's `SHASUMS256.txt`
 * lists for the zip, and by the sha256 of the executable inside it. A changed asset is refused.
 */
export const BUN_RELEASES: Record<BunTarget, PinnedBun> = {
  "windows-x64": {
    version: BUN_VERSION,
    asset: "bun-windows-x64.zip",
    url: `${RELEASES_URL}/bun-v${BUN_VERSION}/bun-windows-x64.zip`,
    sha256: "ce4c17497b2f29712a99d3d53f028de28cd42e3bacb8589599e7f000e49b6405",
    member: "bun-windows-x64/bun.exe",
    binary: "bun.exe",
    binarySha256: "15277c59ccd6c6c20f8dc9716c2b59c1776320d606b6a8658f70be8799519ca4",
  },
  "linux-x64": {
    version: BUN_VERSION,
    asset: "bun-linux-x64.zip",
    url: `${RELEASES_URL}/bun-v${BUN_VERSION}/bun-linux-x64.zip`,
    sha256: "36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913",
    member: "bun-linux-x64/bun",
    binary: "bun",
    binarySha256: "a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c",
  },
};

export function shasumsUrl(version: string): string {
  return `${RELEASES_URL}/bun-v${version}/SHASUMS256.txt`;
}

/** Undefined when package.json pins the Bun these hashes are for, else the error to show. */
export function checkPackageManager(
  packageJson: string,
  version = BUN_VERSION,
): string | undefined {
  let pinned: unknown;
  try {
    pinned = (JSON.parse(packageJson) as { packageManager?: unknown }).packageManager;
  } catch {
    pinned = undefined;
  }
  if (typeof pinned !== "string" || !pinned.startsWith("bun@")) {
    return 'package.json has no "packageManager": "bun@<version>".';
  }
  if (pinned === `bun@${version}`) return undefined;
  return `package.json pins ${pinned}, but the sandbox has hashes for Bun ${version} only; pin the new release in scripts/sandbox/model/bun-release.ts.`;
}

/**
 * Undefined when the release's `SHASUMS256.txt` lists the pinned sha256 for the zip and the
 * downloaded bytes have it, else the error to show.
 */
export function checkBunZip(
  release: PinnedBun,
  zip: Uint8Array,
  shasums: string,
): string | undefined {
  const published = shasums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, asset]) => asset === release.asset)?.[0];
  if (published === undefined) {
    return `SHASUMS256.txt of Bun ${release.version} does not list ${release.asset}.`;
  }
  if (published !== release.sha256) {
    return `SHASUMS256.txt of Bun ${release.version} lists ${published} for ${release.asset}, but the pinned sha256 is ${release.sha256}; refusing it.`;
  }
  return sha256Mismatch(release.asset, release.sha256, zip);
}

/** The verified executable, kept under .local/ and keyed by version and archive hash. */
export function bunCachePath(paths: SandboxPaths, release: PinnedBun): string {
  return join(paths.bunCache, `${release.version}-${release.sha256.slice(0, 16)}`, release.binary);
}
