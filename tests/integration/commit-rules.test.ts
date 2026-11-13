import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..", "..");
const commitlint = join(repo, "node_modules", ".bin", "commitlint");
// Each test starts commitlint as its own process; on Windows CI a cold start can pass the
// default 5 s, so the tests get more time instead of failing on a slow runner.
const TIMEOUT = 30_000;

let fixture: string;

beforeEach(() => {
  fixture = join(repo, ".temp", "tests", `commit-rules-${crypto.randomUUID()}`);
  mkdirSync(fixture, { recursive: true });
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function lint(message: string) {
  const file = join(fixture, "COMMIT_EDITMSG");
  writeFileSync(file, message);
  const result = Bun.spawnSync([commitlint, "--edit", file], { cwd: repo, stdin: "ignore" });
  return { exitCode: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
}

describe("commit message rules (Conventional Commits)", () => {
  test(
    "accepts a conventional message",
    () => {
      const result = lint("feat(offers): add the Greenhouse connector\n");

      expect(result.exitCode).toBe(0);
    },
    TIMEOUT,
  );

  test(
    "rejects a message without a type",
    () => {
      const result = lint("added the Greenhouse connector\n");

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("type may not be empty");
      expect(result.output).toContain("subject may not be empty");
    },
    TIMEOUT,
  );

  test(
    "rejects an unknown type",
    () => {
      const result = lint("stuff: add the Greenhouse connector\n");

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("type must be one of");
    },
    TIMEOUT,
  );
});
