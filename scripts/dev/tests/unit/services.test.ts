import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDevEngine } from "@scripts/dev/adapters/engine";
import { nodeFolders } from "@scripts/dev/adapters/system";
import { devPaths } from "@scripts/dev/model/paths";
import { followLogs, runGoop, stopDev } from "@scripts/dev/services/dev";
import type { Clock, DevDeps } from "@scripts/dev/types/dev";
import type {
  EngineName,
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "@scripts/shared/containers";

const repo = resolve(import.meta.dir, "..", "..", "..", "..");

type Reply = Partial<ProcessResult> | undefined;

/** Answers each engine call by the first matching rule; anything else succeeds silently. */
class FakeRunner implements ProcessRunner {
  readonly calls: ProcessRequest[] = [];
  constructor(private readonly reply: (args: string[]) => Reply) {}

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.calls.push(request);
    return { exitCode: 0, stdout: "", stderr: "", ...this.reply(this.args(request)) };
  }

  /** The engine subcommand, without the program and Podman's six storage flags. */
  args(request: ProcessRequest): string[] {
    return request.command.slice(request.command[0] === "podman" ? 7 : 1);
  }

  /** One short label per call, to read the flow. */
  flow(): string[] {
    return this.calls.map((call) => {
      const args = this.args(call);
      if (args[0] === "exec") return args.includes("test") ? "wait" : "goop";
      if (args[0] === "container") return "inspect";
      if (args[0] === "image") return "image";
      if (args[0] === "run") return "start";
      return args[0] ?? "";
    });
  }
}

class FakeClock implements Clock {
  current = 0;
  now(): number {
    return this.current;
  }
  async sleep(ms: number): Promise<void> {
    this.current += ms;
  }
}

const ok = (stdout = ""): Reply => ({ exitCode: 0, stdout });
const fail = (stderr = "error"): Reply => ({ exitCode: 125, stderr });

let fixture: string;
let lines: string[];

beforeEach(() => {
  fixture = join(repo, ".temp", "tests", `dev-services-${crypto.randomUUID()}`);
  mkdirSync(fixture, { recursive: true });
  lines = [];
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function deps(runner: FakeRunner, engine: EngineName = "podman", terminal = false): DevDeps {
  const paths = devPaths(fixture);
  return {
    paths,
    engine: createDevEngine(engine, runner, paths, 1000, 1000),
    folders: nodeFolders,
    clock: new FakeClock(),
    output: {
      info: (line) => lines.push(`out: ${line}`),
      error: (line) => lines.push(`err: ${line}`),
    },
    terminal,
  };
}

/** A container that is not running at first, then runs once started. */
function freshEngine(options: { image?: boolean; stale?: boolean; readyAfter?: number } = {}) {
  let started = false;
  let polls = 0;
  return new FakeRunner((args) => {
    switch (args[0]) {
      case "container":
        if (started) return ok("true\n");
        return options.stale ? ok("false\n") : fail("no such container");
      case "image":
        return options.image === false ? fail("image not known") : ok("123\n");
      case "run":
        started = true;
        return ok("abc123\n");
      case "exec":
        if (args.includes("test")) {
          polls += 1;
          return polls > (options.readyAfter ?? 0) ? ok() : { exitCode: 1 };
        }
        return { exitCode: 3 };
      default:
        return ok();
    }
  });
}

const HINT = "See its output with: bun run dev:logs";

describe("bun run dev", () => {
  test("not running: builds a missing image, removes nothing, starts, waits, runs goop", async () => {
    const runner = freshEngine({ image: false, readyAfter: 2 });
    const exitCode = await runGoop(deps(runner), ["--help"]);

    expect(exitCode).toBe(3);
    expect(runner.flow()).toEqual([
      "inspect",
      "image",
      "build",
      "start",
      "wait",
      "inspect",
      "wait",
      "inspect",
      "wait",
      "goop",
    ]);
    expect(lines).toEqual([
      "out: Building the dev image localhost/goop-dev:1 from scripts/dev/Containerfile (once, a few minutes)...",
      "out: Starting the dev container goop-dev: the goop daemon, restarted on every source change.",
      "out: Waiting for the goop daemon...",
    ]);
    const build = runner.calls[2];
    expect(build?.stream).toBe(true);
    expect(runner.args(build as ProcessRequest)).toEqual([
      "build",
      "--tag",
      "localhost/goop-dev:1",
      "--file",
      join(fixture, "scripts", "dev", "Containerfile"),
      join(fixture, "scripts", "dev"),
    ]);
    const goop = runner.calls.at(-1) as ProcessRequest;
    expect(runner.args(goop).slice(-4)).toEqual(["bun", "--no-env-file", "src/main.ts", "--help"]);
    // Without a terminal, stdin is still attached, so `echo x | bun run dev` reaches goop.
    expect(runner.args(goop).slice(0, 2)).toEqual(["exec", "-i"]);
    expect(goop.interactive).toBe(true);
    // The host folders exist before the start, and Podman's storage before every call.
    for (const folder of [
      ".local/dev/node_modules",
      ".temp/dev",
      ".temp/tmp",
      ".local/containers/storage",
      ".temp/containers/run",
      ".temp/containers/tmp",
    ]) {
      expect(existsSync(join(fixture, folder))).toBe(true);
    }
    for (const call of runner.calls) {
      expect(call.command.slice(0, 7)).toEqual([
        "podman",
        "--root",
        join(fixture, ".local", "containers", "storage"),
        "--runroot",
        join(fixture, ".temp", "containers", "run"),
        "--tmpdir",
        join(fixture, ".temp", "containers", "tmp"),
      ]);
      expect(call.env).toEqual({ TMPDIR: join(fixture, ".temp", "containers", "tmp") });
    }
  });

  test("a stale container is removed before the start, and an existing image is kept", async () => {
    const runner = freshEngine({ stale: true });
    expect(await runGoop(deps(runner), [])).toBe(3);
    expect(runner.flow()).toEqual(["inspect", "rm", "image", "start", "wait", "goop"]);
    expect(runner.args(runner.calls[1] as ProcessRequest)).toEqual(["rm", "--force", "goop-dev"]);
    expect(lines).toEqual([
      "out: Starting the dev container goop-dev: the goop daemon, restarted on every source change.",
    ]);
  });

  test("running: goop runs at once, attached to the terminal", async () => {
    const runner = new FakeRunner((args) => (args[0] === "container" ? ok("true\n") : ok()));
    expect(await runGoop(deps(runner, "podman", true), ["daemon"])).toBe(0);
    expect(runner.flow()).toEqual(["inspect", "wait", "goop"]);
    const goop = runner.calls.at(-1) as ProcessRequest;
    expect(runner.args(goop).slice(0, 2)).toEqual(["exec", "-it"]);
    expect(goop.interactive).toBe(true);
    expect(lines).toEqual([]);
  });

  test("Docker starts the container as the host user, with no storage flags", async () => {
    const runner = freshEngine();
    expect(await runGoop(deps(runner, "docker"), [])).toBe(3);
    const start = runner.calls.find((call) => call.command[1] === "run") as ProcessRequest;
    expect(start.command[0]).toBe("docker");
    expect(start.command.slice(-5)).toEqual([
      "--user",
      "1000:1000",
      "localhost/goop-dev:1",
      "bash",
      join(fixture, "scripts", "dev", "entrypoint.sh"),
    ]);
  });

  test("a failed build stops before the start", async () => {
    const runner = new FakeRunner((args) =>
      args[0] === "container" || args[0] === "image"
        ? fail()
        : args[0] === "build"
          ? { exitCode: 1 }
          : ok(),
    );
    expect(await runGoop(deps(runner), [])).toBe(1);
    expect(runner.flow()).toEqual(["inspect", "image", "build"]);
    expect(lines.at(-1)).toBe("err: Building localhost/goop-dev:1 failed; see the output above.");
  });

  test("a failed start exits 1 with the dev:logs hint", async () => {
    const runner = new FakeRunner((args) =>
      args[0] === "container" ? fail() : args[0] === "run" ? fail("Error: port in use\n") : ok(),
    );
    expect(await runGoop(deps(runner), [])).toBe(1);
    expect(runner.flow()).toEqual(["inspect", "image", "start"]);
    expect(lines.slice(1)).toEqual([
      "err: Cannot start goop-dev: Error: port in use",
      `err: ${HINT}`,
    ]);
  });

  test("a daemon that never makes its socket times out after 300 s", async () => {
    const runner = freshEngine({ readyAfter: Number.POSITIVE_INFINITY });
    const d = deps(runner);
    expect(await runGoop(d, [])).toBe(1);
    expect(d.clock.now()).toBe(300_000);
    expect(runner.flow().filter((step) => step === "wait")).toHaveLength(301);
    expect(runner.flow()).not.toContain("goop");
    expect(lines.slice(1)).toEqual([
      "out: Waiting for the goop daemon...",
      "err: The goop daemon did not start within 300 s.",
      `err: ${HINT}`,
    ]);
  });

  test("a container that stops while waiting exits 1 with the dev:logs hint", async () => {
    let inspections = 0;
    const runner = new FakeRunner((args) => {
      if (args[0] === "container") {
        inspections += 1;
        return inspections === 1 ? fail() : ok("false\n");
      }
      if (args[0] === "exec") return { exitCode: 1 };
      return ok();
    });
    expect(await runGoop(deps(runner), [])).toBe(1);
    expect(runner.flow()).toEqual(["inspect", "image", "start", "wait", "inspect"]);
    expect(lines.slice(1)).toEqual([
      "out: Waiting for the goop daemon...",
      "err: goop-dev stopped before the goop daemon was ready.",
      `err: ${HINT}`,
    ]);
  });
});

describe("bun run dev:logs and dev:stop", () => {
  test("logs follows the container, streamed", async () => {
    const runner = new FakeRunner(() => ({ exitCode: 130 }));
    expect(await followLogs(deps(runner))).toBe(130);
    expect(runner.args(runner.calls[0] as ProcessRequest)).toEqual([
      "logs",
      "--follow",
      "goop-dev",
    ]);
    expect(runner.calls[0]?.stream).toBe(true);
  });

  test("stop removes the container and keeps the data", async () => {
    const runner = new FakeRunner((args) => (args[0] === "container" ? ok("false\n") : ok()));
    expect(await stopDev(deps(runner))).toBe(0);
    expect(runner.flow()).toEqual(["inspect", "rm"]);
    expect(lines).toEqual(["out: Removed goop-dev; .temp/dev/ and .local/dev/ are kept."]);
  });

  test("stop on a missing container is not an error", async () => {
    const runner = new FakeRunner(() => fail("no such container"));
    expect(await stopDev(deps(runner))).toBe(0);
    expect(runner.flow()).toEqual(["inspect"]);
    expect(lines).toEqual(["out: goop-dev is not running."]);
  });

  test("a failed removal exits 1", async () => {
    const runner = new FakeRunner((args) =>
      args[0] === "container" ? ok("true\n") : fail("Error: container is stuck\n"),
    );
    expect(await stopDev(deps(runner))).toBe(1);
    expect(lines).toEqual(["err: Cannot remove goop-dev: Error: container is stuck"]);
  });
});
