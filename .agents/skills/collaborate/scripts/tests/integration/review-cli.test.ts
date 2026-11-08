import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "..", "..", "review.ts");
const USAGE =
  "Usage: bun scripts/dev-env/run.ts bun .agents/skills/collaborate/scripts/review.ts <pull request number>\n";

function run(args: string[]) {
  // An empty PATH: a usage error must stop before gh is ever called.
  const result = Bun.spawnSync([process.execPath, cli, ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { PATH: "" },
    stdin: "ignore",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("review.ts usage", () => {
  test("without a pull request number it prints the usage and exits 2", () => {
    expect(run([])).toEqual({ exitCode: 2, stdout: "", stderr: USAGE });
  });

  test("a number that is not a positive integer is refused the same way", () => {
    for (const arg of ["0", "-3", "7.5", "seven", "77abc"]) {
      expect(run([arg])).toEqual({ exitCode: 2, stdout: "", stderr: USAGE });
    }
  });

  test("more than one argument is refused", () => {
    expect(run(["77", "78"])).toEqual({ exitCode: 2, stdout: "", stderr: USAGE });
  });
});
