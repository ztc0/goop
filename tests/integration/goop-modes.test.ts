// The real entry, `src/main.ts`, run as goop runs it: `goop`, `goop daemon` and `goop --help`
// (daemon-ipc T3, S1, S2). Each test gets a fresh 0700 folder under `.temp/tests/`, and the runtime
// folder (`GOOP_RUNTIME_DIR`) goes inside it.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..", "..");
const LISTENING = "goop daemon is listening.\n";
const NOT_RUNNING = "goop daemon is not running. Start it in another terminal with: goop daemon\n";
const USAGE = [
  "Usage:",
  "  goop          Open goop; the daemon must be running",
  "  goop daemon   Run the daemon, which owns the models, the queue and the database",
  "  goop --help   Show this help",
  "",
].join("\n");

const created: string[] = [];
const daemons: Bun.Subprocess[] = [];

afterEach(async () => {
  for (const daemon of daemons.splice(0)) {
    daemon.kill("SIGKILL");
    await daemon.exited;
  }
  for (const folder of created.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A fresh runtime folder path, not created yet, inside a 0700 folder removed after the test. */
function runtimeFolder(): string {
  const folder = join(repo, ".temp", "tests", `goop-${crypto.randomUUID().slice(0, 8)}`);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  created.push(folder);
  return join(folder, "run");
}

function environment(runtime: string | undefined): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, GOOP_RUNTIME_DIR: runtime };
  if (runtime === undefined) delete env.XDG_RUNTIME_DIR;
  return env;
}

/** Runs goop to the end. */
async function goop(args: string[], runtime?: string) {
  const child = Bun.spawn([process.execPath, "src/main.ts", ...args], {
    cwd: repo,
    env: environment(runtime),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

/** Starts `goop daemon` and waits for its first line; the rest of stdout stays readable. */
async function startDaemon(runtime: string) {
  const child = Bun.spawn([process.execPath, "src/main.ts", "daemon"], {
    cwd: repo,
    env: environment(runtime),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  daemons.push(child);
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  while (!stdout.includes("\n")) {
    const chunk = await reader.read();
    if (chunk.done) break;
    stdout += decoder.decode(chunk.value, { stream: true });
  }
  const rest = async () => {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      stdout += decoder.decode(chunk.value, { stream: true });
    }
    return stdout;
  };
  return { child, firstLine: stdout, rest, stderr: () => new Response(child.stderr).text() };
}

/** Sends raw lines to the daemon's socket and collects what comes back until `count` lines. */
async function exchange(runtime: string, lines: string[], count: number): Promise<string[]> {
  let received = "";
  const { promise, resolve: done } = Promise.withResolvers<string[]>();
  const socket = await Bun.connect({
    unix: join(runtime, "goop.sock"),
    socket: {
      data(_socket, chunk) {
        received += chunk.toString();
        const replies = received.split("\n").filter(Boolean);
        if (replies.length >= count) done(replies);
      },
    },
  });
  socket.write(lines.map((line) => `${line}\n`).join(""));
  const replies = await promise;
  socket.end();
  return replies;
}

describe("goop --help", () => {
  test("prints the usage on stdout and exits 0", async () => {
    for (const option of ["--help", "-h"]) {
      expect(await goop([option])).toEqual({ exitCode: 0, stdout: USAGE, stderr: "" });
    }
  });

  test("an unknown command prints the problem and the usage on stderr and exits 2", async () => {
    expect(await goop(["deamon"])).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: `Unknown command: "deamon"\n${USAGE}`,
    });
  });
});

describe.skipIf(process.platform === "win32")("goop", () => {
  test("asks the running daemon and prints its answer, exiting 0", async () => {
    const runtime = runtimeFolder();
    await startDaemon(runtime);

    expect(await goop([], runtime)).toEqual({
      exitCode: 0,
      stdout: "goop daemon answered: pong\n",
      stderr: "",
    });
  });

  test("without a daemon it says how to start one, exits 1 and starts nothing", async () => {
    const runtime = runtimeFolder();

    expect(await goop([], runtime)).toEqual({ exitCode: 1, stdout: "", stderr: NOT_RUNNING });
    // It did not create the runtime folder, so no daemon listens there.
    expect(existsSync(runtime)).toBe(false);
  });

  test("with the runtime folder but no socket it says the same and creates no socket", async () => {
    const runtime = runtimeFolder();
    mkdirSync(runtime, { mode: 0o700 });

    expect(await goop([], runtime)).toEqual({ exitCode: 1, stdout: "", stderr: NOT_RUNNING });
    expect(existsSync(join(runtime, "goop.sock"))).toBe(false);
  });

  test("after the daemon stops it says the daemon is not running", async () => {
    const runtime = runtimeFolder();
    const daemon = await startDaemon(runtime);
    daemon.child.kill("SIGTERM");
    await daemon.child.exited;

    expect(await goop([], runtime)).toEqual({ exitCode: 1, stdout: "", stderr: NOT_RUNNING });
  });
});

describe.if(process.platform === "win32")("goop on Windows", () => {
  test("both modes say goop does not run there yet and exit 1", async () => {
    for (const args of [[], ["daemon"]]) {
      expect(await goop(args, runtimeFolder())).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "goop does not run on Windows yet (daemon-ipc T5).\n",
      });
    }
  });
});

describe.skipIf(process.platform === "win32")("goop daemon", () => {
  test("listens in the runtime folder and says so in one line", async () => {
    const runtime = runtimeFolder();
    const daemon = await startDaemon(runtime);

    expect(daemon.firstLine).toBe(LISTENING);
    expect(existsSync(join(runtime, "goop.sock"))).toBe(true);
  });

  test("answers ping, an unknown method and an invalid message, never repeating the input", async () => {
    const runtime = runtimeFolder();
    await startDaemon(runtime);

    const replies = await exchange(
      runtime,
      [
        '{"jsonrpc":"2.0","method":"ping"}',
        '{"jsonrpc":"2.0","id":1,"method":"ping"}',
        '{"jsonrpc":"2.0","id":2,"method":"unlock","params":["hunter2"]}',
        "hunter2",
      ],
      3,
    );

    expect(replies).toEqual([
      '{"jsonrpc":"2.0","id":1,"result":"pong"}',
      '{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"Method not found"}}',
      '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}',
    ]);
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    test(`${signal} removes the socket and exits 0`, async () => {
      const runtime = runtimeFolder();
      const daemon = await startDaemon(runtime);

      daemon.child.kill(signal);

      expect(await daemon.child.exited).toBe(0);
      expect(await daemon.rest()).toBe(LISTENING);
      expect(await daemon.stderr()).toBe("");
      expect(existsSync(join(runtime, "goop.sock"))).toBe(false);
    });
  }

  test("a second daemon is refused, exits 1 and leaves the first one answering", async () => {
    const runtime = runtimeFolder();
    await startDaemon(runtime);

    expect(await goop(["daemon"], runtime)).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "goop daemon is already running\n",
    });
    expect(await exchange(runtime, ['{"jsonrpc":"2.0","id":1,"method":"ping"}'], 1)).toEqual([
      '{"jsonrpc":"2.0","id":1,"result":"pong"}',
    ]);
  });

  test("a runtime folder open to other users is refused with its reason and exits 1", async () => {
    const runtime = runtimeFolder();
    mkdirSync(runtime);
    chmodSync(runtime, 0o755);

    expect(await goop(["daemon"], runtime)).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `The runtime folder is open to other users (mode 0755, it must be 0700): ${runtime}\n`,
    });
    expect(existsSync(join(runtime, "goop.sock"))).toBe(false);
  });

  test("without a runtime folder it names the variables to set and exits 1", async () => {
    expect(await goop(["daemon"], undefined)).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "No runtime folder: set GOOP_RUNTIME_DIR or XDG_RUNTIME_DIR\n",
    });
  });
});
