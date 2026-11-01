import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..", "..");

// Lifecycle hooks run by package managers, not by people.
const LIFECYCLE_SCRIPTS = new Set(["prepare"]);

test("AGENTS.md lists every package script in its Commands table", async () => {
  const pkg = await Bun.file(join(repo, "package.json")).json();
  const agents = await Bun.file(join(repo, "AGENTS.md")).text();
  const scripts = Object.keys(pkg.scripts).filter((name) => !LIFECYCLE_SCRIPTS.has(name));

  const missing = scripts.filter((name) => !agents.includes(`| \`bun run ${name}\``));

  expect(missing).toEqual([]);
});
