// Every runtime dependency ships inside the goop executable, so its license travels with it:
// THIRD_PARTY_LICENSES.md names each one with its exact version and its license text.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SQLITE3MC_LINUX } from "@scripts/native-libs/sqlite3mc/recipe";

const repo = resolve(import.meta.dir, "..", "..");
const read = (file: string) => readFileSync(join(repo, file), "utf8");

test("THIRD_PARTY_LICENSES.md lists every runtime dependency with its version and license", () => {
  const { dependencies = {} } = JSON.parse(read("package.json")) as {
    dependencies?: Record<string, string>;
  };
  expect(existsSync(join(repo, "THIRD_PARTY_LICENSES.md"))).toBe(true);
  const notices = read("THIRD_PARTY_LICENSES.md");

  for (const [name, version] of Object.entries(dependencies)) {
    const { license } = JSON.parse(read(join("node_modules", name, "package.json"))) as {
      license: string;
    };
    expect(notices).toContain(`## ${name} ${version} (${license})`);
  }
});

test("THIRD_PARTY_LICENSES.md lists the native library bun run build embeds, at its pinned version", () => {
  // The pinned archive is named sqlite3mc-<version>-sqlite-<SQLite version>-amalgamation.zip.
  const [, sqlite3mc, sqlite] =
    /^sqlite3mc-(\d+\.\d+\.\d+)-sqlite-(\d+\.\d+\.\d+)-/.exec(SQLITE3MC_LINUX.archive.name) ?? [];
  const notices = read("THIRD_PARTY_LICENSES.md");

  expect(notices).toContain(`## sqlite3mc ${sqlite3mc} (MIT)`);
  expect(notices).toContain(`## SQLite ${sqlite} (public domain)`);
});
