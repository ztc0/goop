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
import { join, resolve } from "node:path";
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
// Built by `bun run build:native`; CI has no build until native-library T7, so the real
// compile skips there. `bun run sandbox test` sets GOOP_REQUIRE_NATIVE=1, so it never skips in
// a sandbox.
const missing =
  process.env.GOOP_REQUIRE_NATIVE !== "1" && !existsSync(join(native, "manifest.json"));

let fixture = "";

beforeEach(() => {
  mkdirSync(join(repo, ".temp", "tests"), { recursive: true });
  fixture = mkdtempSync(join(repo, ".temp", "tests", "build-"));
});

afterEach(() => {
  const extracted = join(fixture, "home", "lib", "native");
  if (existsSync(extracted)) {
    for (const folder of readdirSync(extracted)) {
      for (const file of readdirSync(join(extracted, folder))) {
        chmodSync(join(extracted, folder, file), 0o600);
      }
    }
  }
  rmSync(fixture, { recursive: true, force: true });
});

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
