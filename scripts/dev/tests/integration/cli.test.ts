import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { USAGE } from "@scripts/dev/model/cli-args";

const repo = resolve(import.meta.dir, "..", "..", "..", "..");
const cliScript = join(repo, "scripts", "dev", "cli.ts");

// Usage errors never reach a container engine: PATH holds none here.
function cli(args: string[]) {
  const result = Bun.spawnSync([process.execPath, cliScript, ...args], {
    env: { ...process.env, PATH: "" },
    stdin: "ignore",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

test("package.json runs dev, dev:logs and dev:stop through this CLI in the repo-local environment", async () => {
  const pkg = await Bun.file(join(repo, "package.json")).json();
  const cli = "bun scripts/dev-env/run.ts bun scripts/dev/cli.ts";
  expect(pkg.scripts.dev).toBe(`${cli} goop`);
  expect(pkg.scripts["dev:logs"]).toBe(`${cli} logs`);
  expect(pkg.scripts["dev:stop"]).toBe(`${cli} stop`);
});

describe("scripts/dev/cli.ts usage", () => {
  test("an unknown command prints the usage and exits 2", () => {
    expect(cli(["start"])).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: `Unknown command: start\n${USAGE}`,
    });
  });

  test("no command prints the usage and exits 2", () => {
    expect(cli([])).toEqual({ exitCode: 2, stdout: "", stderr: `Missing command.\n${USAGE}` });
  });

  test("stop with an argument prints the usage and exits 2", () => {
    expect(cli(["stop", "now"])).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: `stop takes no arguments.\n${USAGE}`,
    });
  });

  test("with no container engine, a command exits 1 and says what to install", () => {
    expect(cli(["stop"])).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "No container engine found. Install Podman (recommended) or Docker.\n",
    });
  });
});
