import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { USAGE } from "../../model/cli-args";

const repo = resolve(import.meta.dir, "..", "..", "..", "..");
const cli = join(repo, "scripts", "native-libs", "cli.ts");
let fixture: string;

beforeEach(() => {
  mkdirSync(join(repo, ".temp", "tests"), { recursive: true });
  fixture = mkdtempSync(join(repo, ".temp", "tests", "native-libs-cli-"));
  mkdirSync(join(fixture, "bin"));
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

/** Runs the CLI against the fixture as the repo root, with only the fixture's bin/ on PATH. */
function run(...args: string[]) {
  const child = Bun.spawnSync([process.execPath, cli, ...args], {
    env: { ...process.env, GOOP_REPO_ROOT: fixture, PATH: join(fixture, "bin") },
  });
  return {
    exitCode: child.exitCode,
    stdout: child.stdout.toString(),
    stderr: child.stderr.toString(),
  };
}

describe("native-libs:build", () => {
  test("--help prints the usage and exits 0", () => {
    expect(run("--help")).toEqual({ exitCode: 0, stdout: USAGE, stderr: "" });
  });

  test("a wrong argument prints the error and the usage and exits 2", () => {
    expect(run("--fast")).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: `Unknown option: --fast\n${USAGE}`,
    });
    expect(run("sqlite-vec")).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: `Unknown library: sqlite-vec (expected sqlite3mc).\n${USAGE}`,
    });
  });

  test("without a container engine it stops before writing anything", () => {
    const result = run("sqlite3mc");
    if (process.platform !== "linux" || process.arch !== "x64") {
      expect(result).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "native-libs:build runs on Linux x86_64 only.\n",
      });
    } else {
      expect(result).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "No container engine found. Install Podman (recommended) or Docker.\n",
      });
    }
    expect(readdirSync(fixture)).toEqual(["bin"]);
  });
});
