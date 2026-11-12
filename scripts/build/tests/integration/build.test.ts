import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { bunCompiler } from "@scripts/build/adapters/compiler";
import { notBuilt, USAGE } from "@scripts/build/model/build";
import { buildExecutable } from "@scripts/build/services/build";
import { terminalOutput } from "@scripts/shared/containers";
import {
  builtNativeLibrary,
  nativePlatform,
  parseNativeManifest,
  pinnedLibrary,
} from "@/shared/vault";

const repo = resolve(import.meta.dir, "..", "..", "..", "..");
const cli = join(repo, "scripts", "build", "cli.ts");
const native = join(repo, ".local", "build", "native");
const platform = nativePlatform(process.platform, process.arch);
const linux = process.platform === "linux";
// Built by `bun run build:native`; without it the real compile skips. CI downloads the built
// libraries and `bun run sandbox test` copies them, and both set GOOP_REQUIRE_NATIVE=1, so it
// never skips there.
const missing =
  process.env.GOOP_REQUIRE_NATIVE !== "1" && !existsSync(join(native, "manifest.json"));

let fixture = "";

beforeEach(() => {
  mkdirSync(join(repo, ".temp", "tests"), { recursive: true });
  fixture = mkdtempSync(join(repo, ".temp", "tests", "build-"));
});

afterEach(async () => {
  for (const daemon of daemons.splice(0)) {
    daemon.kill("SIGKILL");
    await daemon.exited;
  }
  for (const home of ["home", ".local"]) {
    const extracted = join(fixture, home, "lib", "native");
    if (!existsSync(extracted)) continue;
    for (const folder of readdirSync(extracted)) {
      for (const file of readdirSync(join(extracted, folder))) {
        chmodSync(join(extracted, folder, file), 0o600);
      }
    }
  }
  rmSync(fixture, { recursive: true, force: true });
});

const daemons: Bun.Subprocess[] = [];

function run(...args: string[]) {
  const child = Bun.spawnSync([process.execPath, cli, ...args], {
    env: { ...process.env, GOOP_REPO_ROOT: fixture },
  });
  return {
    exitCode: child.exitCode,
    stdout: child.stdout.toString(),
    stderr: child.stderr.toString(),
  };
}

describe("bun run build", () => {
  test("an argument prints the usage and exits 2", () => {
    expect(run("--fast")).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: `Unknown argument: --fast\n${USAGE}`,
    });
    expect(readdirSync(fixture)).toEqual([]);
  });

  test("without the native libraries it names the command to run and builds nothing", () => {
    const manifest = join(fixture, ".local", "build", "native", "manifest.json");

    expect(run()).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `The native library manifest is missing from ${manifest}. Build the libraries with: bun run build:native\n${notBuilt(platform)}\n`,
    });
    expect(readdirSync(fixture)).toEqual([]);
  });

  test.skipIf(missing)(
    "the compiled executable loads sqlite3mc from its own bytes, extracted by goop (S6)",
    async () => {
      const pinned = pinnedLibrary(
        parseNativeManifest(readFileSync(join(native, "manifest.json"), "utf8")),
        "sqlite3mc",
        platform,
      );
      const outfile = join(fixture, "load-native");
      const exitCode = await buildExecutable(
        { verify: builtNativeLibrary, compiler: bunCompiler, output: terminalOutput },
        {
          root: repo,
          platform,
          entry: join(repo, "scripts", "build", "tests", "fixtures", "load-native.ts"),
          outfile,
        },
      );
      expect(exitCode).toBe(0);

      const home = join(fixture, "home");
      const tmp = join(fixture, "tmp");
      mkdirSync(tmp);
      const executable = readdirSync(fixture).find((name) => name.startsWith("load-native"));
      const start = () => {
        const child = Bun.spawnSync([join(fixture, executable ?? "")], {
          env: { ...process.env, GOOP_HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp },
        });
        return {
          exitCode: child.exitCode,
          stdout: child.stdout.toString(),
          stderr: child.stderr.toString(),
        };
      };
      const folder = join(home, "lib", "native", pinned.sha256);
      const library = join(folder, pinned.file);
      const loaded = {
        exitCode: 0,
        stdout: `${JSON.stringify({ source: "embedded", library, version: pinned.sqliteVersion })}\n`,
        stderr: "",
      };

      expect(start()).toEqual(loaded);
      const sha256 = createHash("sha256").update(readFileSync(library)).digest("hex");
      expect(sha256).toBe(pinned.sha256);
      expect(readdirSync(folder)).toEqual([pinned.file]);
      // goop never handed an embedded path to dlopen, so Bun extracted nothing to TMPDIR.
      expect(readdirSync(tmp)).toEqual([]);
      if (linux) {
        expect(statSync(folder).mode & 0o777).toBe(0o700);
        expect(statSync(library).mode & 0o777).toBe(0o500);
      }

      // A changed copy is replaced from the executable's own bytes before the next load.
      chmodSync(library, 0o600);
      writeFileSync(library, "tampered");
      expect(start()).toEqual(loaded);
      expect(createHash("sha256").update(readFileSync(library)).digest("hex")).toBe(pinned.sha256);
    },
    60_000,
  );
});

/** Every file name under `folder`, at any depth. */
function allNames(folder: string): string[] {
  return readdirSync(folder, { recursive: true }).map((name) => basename(String(name)));
}

/** Sends one request to a daemon's socket and returns the parsed reply. */
async function request(socketPath: string, method: string, params?: unknown): Promise<unknown> {
  const { promise, resolve: done } = Promise.withResolvers<string>();
  let received = "";
  const socket = await Bun.connect({
    unix: socketPath,
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

describe("the compiled goop and the insecure development key (dev-sandbox S8)", () => {
  test.skipIf(missing || !linux)(
    "with GOOP_HOME in a goop repository's .local/ it never uses it: the passphrase seals the vault",
    async () => {
      const outfile = join(fixture, "goop");
      const built = await buildExecutable(
        { verify: builtNativeLibrary, compiler: bunCompiler, output: terminalOutput },
        { root: repo, platform, entry: join(repo, "src", "main.ts"), outfile },
      );
      expect(built).toBe(0);
      // The fixture looks like the goop repository, and asks for the key by every means it can.
      writeFileSync(join(fixture, "package.json"), JSON.stringify({ name: "goop" }));
      const runtime = join(fixture, "run");
      mkdirSync(runtime, { mode: 0o700 });
      const socketPath = join(runtime, "goop.sock");
      const tmp = join(fixture, "tmp");
      mkdirSync(tmp);
      const env = {
        ...process.env,
        GOOP_HOME: join(fixture, ".local"),
        GOOP_RUNTIME_DIR: runtime,
        GOOP_DEV_KEY: "1",
        TMPDIR: tmp,
      };
      const devKeyBefore = existsSync(join(repo, ".temp", "dev", "INSECURE-DEV-KEY"));

      async function daemon() {
        const child = Bun.spawn([outfile, "daemon"], {
          cwd: fixture,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        daemons.push(child);
        const reader = child.stdout.getReader();
        let stdout = "";
        while (stdout.split("\n").length < 3) {
          const chunk = await reader.read();
          if (chunk.done) break;
          stdout += new TextDecoder().decode(chunk.value);
        }
        return { stdout, child };
      }

      const first = await daemon();
      expect(first.stdout).toBe(
        "goop daemon is listening.\nThe vault is not set up yet. Set it up with: goop\n",
      );
      expect(
        await request(socketPath, "vault.setup", { passphrase: "a SECRET passphrase" }),
      ).toMatchObject({
        result: { recoveryKey: expect.any(String) },
      });
      first.child.kill("SIGTERM");
      expect(await first.child.exited).toBe(0);
      expect(readdirSync(join(fixture, ".local", "data")).sort()).toEqual([
        "data-key.passphrase",
        "data-key.recovery",
        "goop.db",
      ]);

      const second = await daemon();
      expect(second.stdout).toBe(
        "goop daemon is listening.\nThe vault is locked. Unlock it with: goop\n",
      );
      second.child.kill("SIGTERM");
      expect(await second.child.exited).toBe(0);

      expect(allNames(fixture)).not.toContain("INSECURE-DEV-KEY");
      expect(existsSync(join(repo, ".temp", "dev", "INSECURE-DEV-KEY"))).toBe(devKeyBefore);
    },
    120_000,
  );
});

describe("the compiled goop and the files Bun loads by itself (dev-sandbox S11)", () => {
  test.skipIf(missing || !linux)(
    "it reads no .env and no bunfig.toml from the folder it starts in",
    async () => {
      const outfile = join(fixture, "goop");
      const built = await buildExecutable(
        { verify: builtNativeLibrary, compiler: bunCompiler, output: terminalOutput },
        { root: repo, platform, entry: join(repo, "src", "main.ts"), outfile },
      );
      expect(built).toBe(0);
      // Without GOOP_RUNTIME_DIR, goop puts its socket in XDG_RUNTIME_DIR/goop/; a .env that
      // sets GOOP_RUNTIME_DIR would move it, and a bunfig.toml preload would print a line.
      const xdg = join(fixture, "xdg");
      const fromEnvFile = join(fixture, "from-env-file");
      mkdirSync(xdg, { mode: 0o700 });
      mkdirSync(fromEnvFile, { mode: 0o700 });
      writeFileSync(join(fixture, ".env"), `GOOP_RUNTIME_DIR=${fromEnvFile}\n`);
      writeFileSync(join(fixture, "preload.js"), 'console.log("bunfig.toml was loaded");\n');
      writeFileSync(join(fixture, "bunfig.toml"), 'preload = ["./preload.js"]\n');
      const tmp = join(fixture, "tmp");
      mkdirSync(tmp);
      const { GOOP_RUNTIME_DIR: _ignored, ...inherited } = process.env;

      const child = Bun.spawn([outfile, "daemon"], {
        cwd: fixture,
        env: { ...inherited, GOOP_HOME: join(fixture, "home"), XDG_RUNTIME_DIR: xdg, TMPDIR: tmp },
        stdout: "pipe",
        stderr: "pipe",
      });
      daemons.push(child);
      const reader = child.stdout.getReader();
      let stdout = "";
      while (stdout.split("\n").length < 3) {
        const chunk = await reader.read();
        if (chunk.done) break;
        stdout += new TextDecoder().decode(chunk.value);
      }
      child.kill("SIGTERM");
      expect(await child.exited).toBe(0);

      expect(stdout).toBe(
        "goop daemon is listening.\nThe vault is not set up yet. Set it up with: goop\n",
      );
      expect(readdirSync(fromEnvFile)).toEqual([]);
    },
    120_000,
  );
});
