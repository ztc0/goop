// The insecure development key end to end (dev-sandbox S8), two real processes: `goop daemon` and
// `goop` from source, in a copy of the repository under `.temp/tests/` (its `src/`, `package.json`,
// `tsconfig.json` and built native libraries), with `GOOP_HOME` in the copy's `.temp/dev/home/` like
// `bun run dev`. The copy keeps the test's key and vault out of the real `.temp/dev/` and
// `.local/`. Skipped without `bun run build:native`, except with GOOP_REQUIRE_NATIVE=1.
import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

const repo = resolve(import.meta.dir, "..", "..");
const native = join(repo, ".local", "build", "native");
const missing =
  process.env.GOOP_REQUIRE_NATIVE !== "1" && !existsSync(join(native, "manifest.json"));
const PASSPHRASE = "correct horse battery SECRET";
const TIMEOUT = 60_000;

const WARNING =
  "goop daemon is using the insecure development key in .temp/dev/ (never use this for real data).\n";
const LISTENING = "goop daemon is listening.\n";
const FIRST_RUN = "The vault is not set up yet. Set it up with: goop\n";
const UNLOCKED = "The vault is unlocked.\n";
const PONG = "goop daemon answered: pong\n";
const KEY_LINE = /^ {4}([0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){7})$/m;

const created: string[] = [];
const daemons: Bun.Subprocess[] = [];

afterEach(async () => {
  for (const daemon of daemons.splice(0)) {
    daemon.kill("SIGKILL");
    await daemon.exited;
  }
  for (const folder of created.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A copy of the repository that goop runs from, with its own `.local/` and `.temp/`. */
function repoCopy(packageName = "goop") {
  const root = join(repo, ".temp", "tests", `dev-key-${crypto.randomUUID().slice(0, 8)}`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  created.push(root);
  cpSync(join(repo, "src"), join(root, "src"), {
    recursive: true,
    filter: (path) => !path.includes(`${sep}tests`),
  });
  cpSync(join(repo, "tsconfig.json"), join(root, "tsconfig.json"));
  const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ ...manifest, name: packageName }));
  cpSync(native, join(root, ".local", "build", "native"), { recursive: true });
  const runtime = join(root, "run");
  mkdirSync(runtime, { mode: 0o700 });
  return {
    root,
    env: {
      ...process.env,
      GOOP_HOME: join(root, ".temp", "dev", "home"),
      GOOP_RUNTIME_DIR: runtime,
    },
    socket: join(runtime, "goop.sock"),
    key: join(root, ".temp", "dev", "INSECURE-DEV-KEY"),
    data: join(root, ".temp", "dev", "home", "data"),
  };
}

type Copy = ReturnType<typeof repoCopy>;

/** Starts `goop daemon` from the copy and waits for `lines` lines; `stop()` returns its output. */
async function startDaemon(copy: Copy, lines: number) {
  const child = Bun.spawn([process.execPath, join(copy.root, "src", "main.ts"), "daemon"], {
    cwd: copy.root,
    env: copy.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  daemons.push(child);
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  while (stdout.split("\n").length <= lines) {
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

/** Runs `goop` from the copy to the end with `input` on its stdin. */
async function goop(copy: Copy, input: string) {
  const child = Bun.spawn([process.execPath, join(copy.root, "src", "main.ts")], {
    cwd: copy.root,
    env: copy.env,
    stdin: new Blob([input]),
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

describe.skipIf(missing || process.platform === "win32")(
  "goop from source unlocks by itself with the insecure development key (skipped without the native library)",
  () => {
    test(
      "set up once with a passphrase; every later daemon start is unlocked without one",
      async () => {
        const copy = repoCopy();
        const first = await startDaemon(copy, 3);
        expect(first.firstLines).toBe(`${WARNING}${LISTENING}${FIRST_RUN}`);

        const setup = await goop(copy, `${PASSPHRASE}\n${PASSPHRASE}\n`);
        const recoveryKey = KEY_LINE.exec(setup.stdout)?.[1] ?? "";
        expect(setup.exitCode).toBe(0);
        expect(setup.stdout.endsWith(PONG)).toBe(true);
        const firstOutput = await first.stop();
        expect(firstOutput).toEqual({
          exitCode: 0,
          stdout: `${WARNING}${LISTENING}${FIRST_RUN}${UNLOCKED}`,
          stderr: "",
        });

        // The development key seals the data key: no passphrase envelope.
        expect(readdirSync(copy.data).sort()).toEqual([
          "data-key.os",
          "data-key.recovery",
          "goop.db",
        ]);
        expect(readdirSync(join(copy.root, ".temp", "dev")).sort()).toEqual([
          "INSECURE-DEV-KEY",
          "home",
        ]);
        expect(statSync(join(copy.root, ".temp", "dev")).mode & 0o777).toBe(0o700);
        expect(statSync(copy.key).mode & 0o777).toBe(0o600);
        const key = readFileSync(copy.key, "utf8");

        const second = await startDaemon(copy, 3);
        expect(second.firstLines).toBe(`${WARNING}${LISTENING}${UNLOCKED}`);
        // goop asks nothing: the vault is already unlocked.
        const ping = await goop(copy, "");
        expect(ping).toEqual({ exitCode: 0, stdout: PONG, stderr: "" });
        const secondOutput = await second.stop();
        expect(secondOutput).toEqual({
          exitCode: 0,
          stdout: `${WARNING}${LISTENING}${UNLOCKED}`,
          stderr: "",
        });

        // The key never reaches any output; the daemon never prints a secret either.
        const text = (runs: { stdout: string; stderr: string }[]) =>
          runs.map((run) => run.stdout + run.stderr).join("\n");
        const everything = text([firstOutput, setup, ping, secondOutput]);
        for (const secret of [key.trim(), key.replaceAll("-", "").trim()]) {
          expect(everything).not.toContain(secret);
        }
        const daemon = text([firstOutput, secondOutput]);
        for (const secret of [PASSPHRASE, recoveryKey]) expect(daemon).not.toContain(secret);
      },
      TIMEOUT,
    );

    test(
      "outside a goop repository the daemon refuses to start and writes no key",
      async () => {
        const copy = repoCopy("not-goop");
        const child = Bun.spawn([process.execPath, join(copy.root, "src", "main.ts"), "daemon"], {
          cwd: copy.root,
          env: copy.env,
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
            "goop will not use the insecure development key: GOOP_HOME is in .temp/dev/, but the folder above src/ is not the goop repository.\n",
        });
        expect(existsSync(join(copy.root, ".temp"))).toBe(false);
        expect(existsSync(copy.data)).toBe(false);
        expect(existsSync(copy.socket)).toBe(false);
      },
      TIMEOUT,
    );
  },
);
