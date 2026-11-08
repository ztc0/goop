import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..", "..");
const relativeImport = /(?:from|import)\s*\(?\s*["']\.\.?\//;

function trackedSources(): string[] {
  const result = Bun.spawnSync(["git", "ls-files", "--", "src", "scripts", "tests"], {
    cwd: repo,
    stdin: "ignore",
  });
  return result.stdout
    .toString()
    .split("\n")
    .filter((file) => /\.tsx?$/.test(file));
}

describe("import aliases", () => {
  test("code imports through @/ and @scripts/, never relative paths", () => {
    const offenders = trackedSources().flatMap((file) =>
      readFileSync(join(repo, file), "utf8")
        .split("\n")
        .flatMap((line, index) => (relativeImport.test(line) ? [`${file}:${index + 1}`] : [])),
    );

    expect(offenders).toEqual([]);
  });
});
