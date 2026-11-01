// T10 spike: downloads the pinned sqlite3mc amalgamation and the sqlite-vec loadable build,
// verifies their sha256, extracts each archive into a fresh folder and compiles libsqlite3mc.so.
// Linux x86_64 only. Run: bun scripts/dev-env/run.ts bun scripts/spikes/encrypted-sqlite/build-artifacts.ts
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { devLayout } from "@/shared/model/dev-layout";
import { repoRoot } from "../../shared/repo-root";
import { sha256File } from "./native-cache";

interface Artifact {
  name: string;
  url: string;
  sha256: string;
}

// Pinned versions and hashes, taken from the SHA256SUMS / checksums.txt files of each release.
const SQLITE3MC: Artifact = {
  name: "sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip",
  url: "https://github.com/utelle/SQLite3MultipleCiphers/releases/download/v2.6.1/sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip",
  sha256: "3f25af603566a23c821d8e581778b5ece2a541d2435776de57b8d845c176815a",
};
const SQLITE_VEC: Artifact = {
  name: "sqlite-vec-0.1.9-loadable-linux-x86_64.tar.gz",
  url: "https://github.com/asg017/sqlite-vec/releases/download/v0.1.9/sqlite-vec-0.1.9-loadable-linux-x86_64.tar.gz",
  sha256: "b959baa1d8dc88861b1edb337b8587178cdcb12d60b4998f9d10b6a82052d5d7",
};

// Compile flags for libsqlite3mc.so. The dispatch table makes every SQLite symbol static and
// exports only the sqlite3mc_api_* table pointers, so it cannot clash with Bun's own SQLite.
const SQLITE3MC_CFLAGS = [
  "-O2",
  "-fPIC",
  "-shared",
  "-DSQLITE_ENABLE_FTS5",
  "-DSQLITE3MC_USE_DISPATCH_TABLE",
  "-DSQLITE_THREADSAFE=1",
];

const layout = devLayout(repoRoot());
const output = join(layout.local.build, "sqlite");

async function download(artifact: Artifact): Promise<string> {
  mkdirSync(layout.temp.downloads, { recursive: true });
  const target = join(layout.temp.downloads, artifact.name);
  if (existsSync(target) && (await sha256File(target)) === artifact.sha256) return target;
  const response = await fetch(artifact.url);
  if (!response.ok) throw new Error(`download failed: ${artifact.url} -> ${response.status}`);
  const partial = `${target}.part`;
  await Bun.write(partial, response);
  const actual = await sha256File(partial);
  if (actual !== artifact.sha256) {
    throw new Error(
      `sha256 mismatch for ${artifact.name}: expected ${artifact.sha256}, got ${actual}`,
    );
  }
  renameSync(partial, target);
  return target;
}

function run(command: string[]): string {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed (${result.exitCode}): ${result.stderr.toString()}`,
    );
  }
  return result.stdout.toString();
}

/** Rejects archive entries that are absolute or climb out of the extraction folder. */
function assertSafeEntries(entries: string[], archive: string): void {
  for (const entry of entries) {
    if (entry.startsWith("/") || entry.split("/").includes("..")) {
      throw new Error(`unsafe entry ${JSON.stringify(entry)} in ${archive}`);
    }
  }
}

function freshExtractDir(name: string): string {
  mkdirSync(layout.temp.extract, { recursive: true });
  return mkdtempSync(join(layout.temp.extract, `${name}-`));
}

async function main(): Promise<void> {
  mkdirSync(output, { recursive: true });

  const zip = await download(SQLITE3MC);
  assertSafeEntries(run(["unzip", "-Z1", zip]).trim().split("\n"), zip);
  const mcDir = freshExtractDir("sqlite3mc-2.6.1");
  run(["unzip", "-q", zip, "-d", mcDir]);

  const tarball = await download(SQLITE_VEC);
  assertSafeEntries(run(["tar", "-tzf", tarball]).trim().split("\n"), tarball);
  const vecDir = freshExtractDir("sqlite-vec-0.1.9");
  run(["tar", "-xzf", tarball, "-C", vecDir, "--no-same-owner", "--no-same-permissions"]);

  const library = join(output, "libsqlite3mc.so");
  const building = `${library}.building`;
  run([
    "gcc",
    ...SQLITE3MC_CFLAGS,
    "-o",
    building,
    join(mcDir, "sqlite3mc_amalgamation.c"),
    "-lm",
    "-lpthread",
  ]);
  renameSync(building, library);
  copyFileSync(join(vecDir, "vec0.so"), join(output, "vec0.so"));

  // libsqlite3mc.so is built here, so its hash is recorded next to it and embedded with it.
  const libraryHash = await sha256File(library);
  writeFileSync(`${library}.sha256`, `${libraryHash}\n`);
  process.stdout.write(`${libraryHash}  ${library}\n`);
  process.stdout.write(
    `${await sha256File(join(output, "vec0.so"))}  ${join(output, "vec0.so")}\n`,
  );
}

await main();
