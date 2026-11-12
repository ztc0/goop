// The real `goop daemon` owning a real vault (daemon-ipc T4, S3, S4, S7, L8): `src/main.ts` runs
// with `GOOP_HOME` and `GOOP_RUNTIME_DIR` in a fresh 0700 folder under `.temp/tests/`. From source
// goop never uses the OS key store (goop S25), so the passphrase seals the data key and nothing
// touches the system. The store opens through the built native library: skipped without
// `bun run build:native`, except with GOOP_REQUIRE_NATIVE=1, where a missing library fails.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..", "..");
const missing =
  process.env.GOOP_REQUIRE_NATIVE !== "1" &&
  !existsSync(join(repo, ".local", "build", "native", "manifest.json"));
const PASSPHRASE = "correct horse battery SECRET";
const WRONG = "wrong horse battery SECRET";
const RECOVERY_KEY = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/;
const TIMEOUT = 30_000;

const created: string[] = [];
const daemons: Bun.Subprocess[] = [];

afterEach(async () => {
  for (const daemon of daemons.splice(0)) {
    daemon.kill("SIGKILL");
    await daemon.exited;
  }
  for (const folder of created.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A fresh 0700 folder for one test: `run/` is the runtime folder, `home/` is `GOOP_HOME`. */
function testFolder() {
  const root = join(repo, ".temp", "tests", `daemon-vault-${crypto.randomUUID().slice(0, 8)}`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  created.push(root);
  return { runtime: join(root, "run"), home: join(root, "home") };
}

type Folder = ReturnType<typeof testFolder>;

/** Starts `goop daemon` and waits for its first two lines; `stop()` ends it and returns its output. */
async function startDaemon(folder: Folder) {
  const child = Bun.spawn([process.execPath, "src/main.ts", "daemon"], {
    cwd: repo,
    env: { ...process.env, GOOP_RUNTIME_DIR: folder.runtime, GOOP_HOME: folder.home },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  daemons.push(child);
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  while (stdout.split("\n").length < 3) {
    const chunk = await reader.read();
    if (chunk.done) break;
    stdout += decoder.decode(chunk.value, { stream: true });
  }
  const firstLines = stdout;
  async function stop() {
    child.kill("SIGTERM");
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      stdout += decoder.decode(chunk.value, { stream: true });
    }
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    return { exitCode, stdout, stderr };
  }
  return { firstLines, stop };
}

/** Sends one request to the daemon's socket and returns the parsed reply. */
async function request(folder: Folder, method: string, params?: unknown): Promise<unknown> {
  const { promise, resolve: done } = Promise.withResolvers<string>();
  let received = "";
  const socket = await Bun.connect({
    unix: join(folder.runtime, "goop.sock"),
    socket: {
      data(_socket, chunk) {
        received += chunk.toString();
        if (received.includes("\n")) done(received.slice(0, received.indexOf("\n")));
      },
    },
  });
  socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`);
  const reply = await promise;
  socket.end();
  return JSON.parse(reply);
}

/** Every byte of every file in the vault folder, to look for a secret in plain text. */
function vaultBytes(folder: Folder): string {
  const data = join(folder.home, "data");
  return readdirSync(data)
    .map((name) => readFileSync(join(data, name)).toString("latin1"))
    .join("\n");
}

const LISTENING = "goop daemon is listening.\n";
const FIRST_RUN = "The vault is not set up yet. Set it up with: goop\n";
const LOCKED = "The vault is locked. Unlock it with: goop\n";
const UNLOCKED = "The vault is unlocked.\n";
const REFUSED = "A wrong passphrase or recovery key was refused.\n";

/** Sets a new vault up through a daemon, and returns the recovery key it gave once. */
async function setUp(folder: Folder): Promise<string> {
  const daemon = await startDaemon(folder);
  expect(daemon.firstLines).toBe(`${LISTENING}${FIRST_RUN}`);
  const reply = (await request(folder, "vault.setup", { passphrase: PASSPHRASE })) as {
    result: { recoveryKey: string };
  };
  expect(reply.result.recoveryKey).toMatch(RECOVERY_KEY);
  expect(await daemon.stop()).toEqual({
    exitCode: 0,
    stdout: `${LISTENING}${FIRST_RUN}${UNLOCKED}`,
    stderr: "",
  });
  return reply.result.recoveryKey;
}

describe.skipIf(missing || process.platform === "win32")(
  "goop daemon and its vault (skipped without .local/build/native/manifest.json; bun run build:native)",
  () => {
    test(
      "a first run sets the vault up with a passphrase and gives the recovery key once",
      async () => {
        const folder = testFolder();
        const recoveryKey = await setUp(folder);

        const data = join(folder.home, "data");
        expect(readdirSync(data).sort()).toEqual([
          "data-key.passphrase",
          "data-key.recovery",
          "goop.db",
        ]);
        expect(statSync(data).mode & 0o777).toBe(0o700);
        for (const name of readdirSync(data)) {
          expect(statSync(join(data, name)).mode & 0o777).toBe(0o600);
        }
        // Neither secret is stored anywhere in plain text: only their envelopes are.
        const bytes = vaultBytes(folder);
        expect(bytes).not.toContain(PASSPHRASE);
        expect(bytes).not.toContain(recoveryKey);
        expect(bytes).not.toContain(recoveryKey.replaceAll("-", ""));
      },
      TIMEOUT,
    );

    test(
      "after a restart it waits locked; a wrong passphrase is refused, the right one unlocks",
      async () => {
        const folder = testFolder();
        await setUp(folder);
        const daemon = await startDaemon(folder);

        expect(daemon.firstLines).toBe(`${LISTENING}${LOCKED}`);
        expect(await request(folder, "vault.status")).toEqual({
          jsonrpc: "2.0",
          id: 1,
          result: { state: "locked" },
        });
        expect(await request(folder, "vault.unlock", { passphrase: WRONG })).toEqual({
          jsonrpc: "2.0",
          id: 1,
          error: { code: 1001, message: "The passphrase or recovery key is not right." },
        });
        expect(await request(folder, "vault.status")).toEqual({
          jsonrpc: "2.0",
          id: 1,
          result: { state: "locked" },
        });
        expect(await request(folder, "ping")).toEqual({ jsonrpc: "2.0", id: 1, result: "pong" });
        expect(await request(folder, "vault.unlock", { passphrase: PASSPHRASE })).toEqual({
          jsonrpc: "2.0",
          id: 1,
          result: { state: "unlocked" },
        });
        expect(await request(folder, "vault.setup", { passphrase: PASSPHRASE })).toEqual({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: 1002,
            message: "The vault is unlocked, so this cannot be done now.",
            data: { state: "unlocked" },
          },
        });

        const output = await daemon.stop();
        expect(output).toEqual({
          exitCode: 0,
          stdout: `${LISTENING}${LOCKED}${REFUSED}${UNLOCKED}`,
          stderr: "",
        });
      },
      TIMEOUT,
    );

    test(
      "without its passphrase envelope the recovery key unlocks it and sets a new passphrase",
      async () => {
        const folder = testFolder();
        const recoveryKey = await setUp(folder);
        rmSync(join(folder.home, "data", "data-key.passphrase"));
        const next = "a brand new SECRET passphrase";

        const daemon = await startDaemon(folder);
        expect(daemon.firstLines).toBe(
          `${LISTENING}The vault needs its recovery key. Enter it with: goop\n`,
        );
        expect(
          await request(folder, "vault.recover", { recoveryKey: WRONG, passphrase: next }),
        ).toMatchObject({ error: { code: 1001 } });
        expect(await request(folder, "vault.recover", { recoveryKey, passphrase: next })).toEqual({
          jsonrpc: "2.0",
          id: 1,
          result: { state: "unlocked" },
        });
        const output = await daemon.stop();
        for (const secret of [recoveryKey, next, WRONG]) {
          expect(output.stdout + output.stderr).not.toContain(secret);
        }

        const restarted = await startDaemon(folder);
        expect(restarted.firstLines).toBe(`${LISTENING}${LOCKED}`);
        expect(await request(folder, "vault.unlock", { passphrase: next })).toMatchObject({
          result: { state: "unlocked" },
        });
        await restarted.stop();
      },
      TIMEOUT,
    );

    test(
      "only a backup can help: the daemon says why, removes its socket and exits 1",
      async () => {
        const folder = testFolder();
        await setUp(folder);
        for (const name of ["data-key.passphrase", "data-key.recovery"]) {
          rmSync(join(folder.home, "data", name));
        }

        const child = Bun.spawn([process.execPath, "src/main.ts", "daemon"], {
          cwd: repo,
          env: { ...process.env, GOOP_RUNTIME_DIR: folder.runtime, GOOP_HOME: folder.home },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect({ exitCode, stdout, stderr }).toEqual({
          exitCode: 1,
          stdout: "",
          stderr:
            "goop cannot start the vault: the store exists but every envelope of its data key is missing; restore the vault folder from a backup. goop never creates a new data key over existing data.\n",
        });
        expect(existsSync(join(folder.runtime, "goop.sock"))).toBe(false);
      },
      TIMEOUT,
    );
  },
);
