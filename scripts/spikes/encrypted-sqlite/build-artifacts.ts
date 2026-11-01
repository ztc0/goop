// T10 spike: downloads the pinned sqlite3mc and sqlite-vec release archives, verifies their
// sha256 and extracts each archive into a fresh folder.
// linux (default): compiles libsqlite3mc.so from the amalgamation and takes vec0.so, on Linux x86_64.
// windows: takes the official sqlite3mc_x64.dll and vec0.dll into .local/build/sqlite/windows/.
// Run: bun scripts/dev-env/run.ts bun scripts/spikes/encrypted-sqlite/build-artifacts.ts [linux|windows]
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
const SQLITE3MC_WIN64: Artifact = {
  name: "sqlite3mc-2.6.1-sqlite-3.54.0-win64.zip",
  url: "https://github.com/utelle/SQLite3MultipleCiphers/releases/download/v2.6.1/sqlite3mc-2.6.1-sqlite-3.54.0-win64.zip",
  sha256: "0183b85d2abc9e3418abd92736cb71355b2bc933f6cda6b56f91653e6628cd74",
};
const SQLITE_VEC_WINDOWS: Artifact = {
  name: "sqlite-vec-0.1.9-loadable-windows-x86_64.tar.gz",
  url: "https://github.com/asg017/sqlite-vec/releases/download/v0.1.9/sqlite-vec-0.1.9-loadable-windows-x86_64.tar.gz",
  sha256: "51581189d52066b4dfc6631f6d7a3eab7dedc2260656ab09ca97ab3fb8165983",
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

async function extractZip(artifact: Artifact, name: string): Promise<string> {
  const zip = await download(artifact);
  assertSafeEntries(run(["unzip", "-Z1", zip]).trim().split("\n"), zip);
  const dir = freshExtractDir(name);
  run(["unzip", "-q", zip, "-d", dir]);
  return dir;
}

async function extractTarball(artifact: Artifact, name: string): Promise<string> {
  const tarball = await download(artifact);
  assertSafeEntries(run(["tar", "-tzf", tarball]).trim().split("\n"), tarball);
  const dir = freshExtractDir(name);
  run(["tar", "-xzf", tarball, "-C", dir, "--no-same-owner", "--no-same-permissions"]);
  return dir;
}

async function report(path: string): Promise<void> {
  process.stdout.write(`${await sha256File(path)}  ${path}\n`);
}

/** The official Windows binaries, used as released: no local build, so their hashes are upstream's. */
async function windows(): Promise<void> {
  const target = join(output, "windows");
  mkdirSync(target, { recursive: true });
  const mcDir = await extractZip(SQLITE3MC_WIN64, "sqlite3mc-2.6.1-win64");
  const vecDir = await extractTarball(SQLITE_VEC_WINDOWS, "sqlite-vec-0.1.9-windows");
  copyFileSync(join(mcDir, "dll", "sqlite3mc_x64.dll"), join(target, "sqlite3mc_x64.dll"));
  copyFileSync(join(vecDir, "vec0.dll"), join(target, "vec0.dll"));
  await report(join(target, "sqlite3mc_x64.dll"));
  await report(join(target, "vec0.dll"));
}

async function linux(): Promise<void> {
  mkdirSync(output, { recursive: true });

  const mcDir = await extractZip(SQLITE3MC, "sqlite3mc-2.6.1");
  const vecDir = await extractTarball(SQLITE_VEC, "sqlite-vec-0.1.9");

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
  await report(join(output, "vec0.so"));
}

const target = process.argv[2] ?? "linux";
if (target === "linux") await linux();
else if (target === "windows") await windows();
else {
  process.stderr.write(`Unknown target ${target}; use linux or windows\n`);
  process.exit(2);
}
