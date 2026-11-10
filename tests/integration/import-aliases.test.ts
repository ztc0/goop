import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..", "..");
const relativeImport = /(?:from|import)\s*\(?\s*["']\.\.?\//;

/**
 * The TypeScript files under src/, scripts/ and tests/, read from the folder itself: the sandbox
 * copies have no git history (and Windows has no git), so `git ls-files` would list nothing there.
 */
function sources(): string[] {
  return [...new Bun.Glob("{src,scripts,tests}/**/*.{ts,tsx}").scanSync({ cwd: repo })]
    .map((file) => file.replaceAll("\\", "/"))
    .sort();
}

describe("import aliases", () => {
  test("code imports through @/ and @scripts/, never relative paths", () => {
    const files = sources();
    // An empty list would pass without checking anything.
    expect(files).toContain("tests/integration/import-aliases.test.ts");
    const offenders = files.flatMap((file) =>
      readFileSync(join(repo, file), "utf8")
        .split("\n")
        .flatMap((line, index) => (relativeImport.test(line) ? [`${file}:${index + 1}`] : [])),
    );

    expect(offenders).toEqual([]);
  });
});
