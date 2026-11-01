import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..", "..");
const runScript = join(repo, "scripts", "dev-env", "run.ts");
const cleanScript = join(repo, "scripts", "dev-env", "clean.ts");

let fixture: string;

beforeEach(() => {
  fixture = join(repo, ".temp", "tests", `dev-scripts-${crypto.randomUUID()}`);
  mkdirSync(fixture, { recursive: true });
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function run(script: string, args: string[]) {
  const result = Bun.spawnSync(["bun", script, ...args], {
    env: { ...process.env, GOOP_REPO_ROOT: fixture },
    stdin: "ignore",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("scripts/dev-env/run.ts", () => {
  test("without a command it prints the usage, exits 2 and creates nothing", () => {
    const result = run(runScript, []);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Usage: bun scripts/dev-env/run.ts <command> [args...]\n");
    expect(existsSync(join(fixture, ".local"))).toBe(false);
    expect(existsSync(join(fixture, ".temp"))).toBe(false);
  });

  test("runs the command with goop, the caches and TMPDIR inside the repo", () => {
    const printEnv =
      "console.log(JSON.stringify(Object.fromEntries(['GOOP_HOME','GOOP_RUNTIME_DIR','BUN_INSTALL_CACHE_DIR','UV_CACHE_DIR','HF_HOME','TMPDIR','TMP','TEMP'].map((k) => [k, process.env[k]]))))";
    const result = run(runScript, ["bun", "-e", printEnv]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      GOOP_HOME: join(fixture, ".local"),
      GOOP_RUNTIME_DIR: join(fixture, ".temp", "run"),
      BUN_INSTALL_CACHE_DIR: join(fixture, ".local", "cache", "bun"),
      UV_CACHE_DIR: join(fixture, ".local", "cache", "uv"),
      HF_HOME: join(fixture, ".local", "cache", "hf"),
      TMPDIR: join(fixture, ".temp", "tmp"),
      TMP: join(fixture, ".temp", "tmp"),
      TEMP: join(fixture, ".temp", "tmp"),
    });
  });

  test("creates the .local and .temp layouts before running the command", () => {
    run(runScript, ["bun", "-e", "0"]);

    for (const dir of [
      "config",
      "data",
      "state",
      "cache/bun",
      "cache/uv",
      "cache/hf",
      "models",
      "bin",
      "build",
    ]) {
      expect(existsSync(join(fixture, ".local", dir))).toBe(true);
    }
    for (const dir of ["tmp", "tests", "downloads", "extract", "scratch", "run"]) {
      expect(existsSync(join(fixture, ".temp", dir))).toBe(true);
    }
  });

  test("exits with the command's exit code", () => {
    const result = run(runScript, ["bun", "-e", "process.exit(3)"]);

    expect(result.exitCode).toBe(3);
  });
});

describe("scripts/dev-env/clean.ts", () => {
  function seed() {
    mkdirSync(join(fixture, ".temp", "tmp"), { recursive: true });
    writeFileSync(join(fixture, ".temp", "tmp", "scratch.txt"), "disposable");
    mkdirSync(join(fixture, ".local", "models"), { recursive: true });
    writeFileSync(join(fixture, ".local", "models", "model.gguf"), "keep");
  }

  test("removes .temp and leaves .local untouched", () => {
    seed();
    const result = run(cleanScript, []);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Removed .temp/\n");
    expect(result.stderr).toBe("");
    expect(existsSync(join(fixture, ".temp"))).toBe(false);
    expect(existsSync(join(fixture, ".local", "models", "model.gguf"))).toBe(true);
  });

  test("reports when there is nothing to clean", () => {
    const result = run(cleanScript, []);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Nothing to clean: .temp/ does not exist.\n");
    expect(result.stderr).toBe("");
  });

  test("--local refuses without an interactive confirmation and deletes nothing", () => {
    seed();
    const result = run(cleanScript, ["--local"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Refusing to delete .local/ without interactive confirmation.\n");
    expect(existsSync(join(fixture, ".local", "models", "model.gguf"))).toBe(true);
    expect(existsSync(join(fixture, ".temp", "tmp", "scratch.txt"))).toBe(true);
  });

  test("rejects unknown options", () => {
    const result = run(cleanScript, ["--everything"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Usage: bun scripts/dev-env/clean.ts [--local]\n");
  });
});
