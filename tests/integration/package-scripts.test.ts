import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..", "..");
const pkg = await Bun.file(join(repo, "package.json")).json();

test("check runs lint, typecheck and test in that order and stops at the first failure", () => {
  expect(pkg.scripts.check).toBe("bun run lint && bun run typecheck && bun run test");
});

test("build:native and sandbox run their CLIs in the repo-local environment", () => {
  expect(pkg.scripts["build:native"]).toBe(
    "bun scripts/dev-env/run.ts bun scripts/native-libs/cli.ts",
  );
  // One script for every sandbox command: `bun run sandbox <command> <system> ...`.
  expect(pkg.scripts.sandbox).toBe("bun scripts/dev-env/run.ts bun scripts/sandbox/cli.ts");
});
