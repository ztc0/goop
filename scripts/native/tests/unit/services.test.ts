import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sandboxPaths } from "../../../sandbox/model/paths";
import { describeOnLinuxHost } from "../../../sandbox/tests/linux-host";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../../../sandbox/types/sandbox";
import { sha256Hex } from "../../../shared/download";
import { nodeNativeFiles } from "../../adapters/files";
import { buildEngine, containerScript } from "../../model/compile";
import { SQLITE3MC_ARCHIVE } from "../../model/inputs";
import { buildManifest, manifestText } from "../../model/manifest";
import { nativePaths } from "../../model/paths";
import { buildNative } from "../../services/build";
import type { NativeBuildDeps } from "../../types/native-build";

const repo = resolve(import.meta.dir, "..", "..", "..", "..");
const ARCHIVE = new TextEncoder().encode("a pinned archive");
const LIBRARY = new TextEncoder().encode("\x7fELF a built library");
const SOURCE = '/* amalgamation */\n#define SQLITE_VERSION        "3.54.0"\n';
const TOOLCHAIN_TEXT = [
  "gcc-14 14.2.0-19",
  "cpp-14 14.2.0-19",
  "libgcc-14-dev 14.2.0-19",
  "binutils 2.44-3",
  "binutils-x86-64-linux-gnu 2.44-3",
  "libc6-dev 2.41-12+deb13u4",
  "unzip 6.0-29+deb13u1",
  "",
].join("\n");

interface Container {
  exitCode?: number;
  source?: string;
  toolchain?: string;
}

/** Plays the engine: `build` succeeds, `run` writes what the container would into its mounts. */
class FakeEngine implements ProcessRunner {
  readonly calls: ProcessRequest[] = [];
  buildExitCode = 0;
  constructor(private readonly container: Container = {}) {}

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.calls.push(request);
    const args = request.command.slice(7);
    if (args[0] === "build") return { exitCode: this.buildExitCode, stdout: "", stderr: "" };
    const mount = (target: string) =>
      args.find((arg) => arg.endsWith(`:${target}`))?.slice(0, -target.length - 1) ?? "";
    const input = args.find((arg) => arg.endsWith(":/build/input:ro"))?.split(":")[0] ?? "";
    expect(readdirSync(input)).toEqual([SQLITE3MC_ARCHIVE.name]);
    writeFileSync(
      join(mount("/build/src"), "sqlite3mc_amalgamation.c"),
      this.container.source ?? SOURCE,
    );
    writeFileSync(join(mount("/build/out"), "libsqlite3mc.so"), LIBRARY);
    writeFileSync(
      join(mount("/build/out"), "toolchain.txt"),
      this.container.toolchain ?? TOOLCHAIN_TEXT,
    );
    return { exitCode: this.container.exitCode ?? 0, stdout: "", stderr: "" };
  }

  /** The subcommands without `podman` and its six storage flags. */
  podman(): string[][] {
    return this.calls.map((call) => call.command.slice(7));
  }
}

let fixture: string;
let lines: string[];

beforeEach(() => {
  fixture = join(repo, ".temp", "tests", `native-build-${crypto.randomUUID()}`);
  mkdirSync(fixture, { recursive: true });
  lines = [];
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function deps(engine: FakeEngine, download?: NativeBuildDeps["download"]): NativeBuildDeps {
  let clock = 0;
  return {
    paths: nativePaths(fixture),
    engine: buildEngine("podman", sandboxPaths(fixture), 1000, 1000),
    runner: engine,
    files: nodeNativeFiles,
    download:
      download ??
      (async (url, maxBytes) => {
        expect([url, maxBytes]).toEqual([SQLITE3MC_ARCHIVE.url, 16 * 1024 * 1024]);
        return ARCHIVE;
      }),
    now: () => (clock += 30_500),
    output: {
      info: (line) => lines.push(`out: ${line}`),
      error: (line) => lines.push(`err: ${line}`),
    },
  };
}

const library = () => join(fixture, ".local", "build", "native", "linux-x64", "libsqlite3mc.so");
const manifest = () => join(fixture, ".local", "build", "native", "manifest.json");
const archive = { ...SQLITE3MC_ARCHIVE, sha256: sha256Hex(ARCHIVE) };

describeOnLinuxHost("native:build (S8)", () => {
  test("nativePaths keeps everything inside the repo", () => {
    expect(nativePaths("/r")).toEqual({
      root: "/r",
      containerfile: "/r/scripts/native/linux/Containerfile",
      containerDirectories: [
        "/r/.local/containers/storage",
        "/r/.temp/containers/run",
        "/r/.temp/containers/tmp",
      ],
      output: "/r/.local/build/native",
      library: "/r/.local/build/native/linux-x64/libsqlite3mc.so",
      manifest: "/r/.local/build/native/manifest.json",
      downloads: "/r/.temp/downloads",
      extract: "/r/.temp/extract",
      staging: "/r/.temp/tmp",
    });
  });

  test("builds the image, compiles in a fresh container and writes the library and its manifest", async () => {
    const engine = new FakeEngine();
    expect(await buildNative(deps(engine), archive)).toBe(0);

    const [build, run] = engine.podman();
    expect(build).toEqual([
      "build",
      "--tag",
      "localhost/goop-native-build:1",
      "--file",
      join(fixture, "scripts/native/linux/Containerfile"),
      join(fixture, "scripts/native/linux"),
    ]);
    expect(run?.slice(0, 3)).toEqual(["run", "--rm", "--network=none"]);
    expect(run?.at(-1)).toBe(containerScript());
    expect(engine.calls.map((call) => call.stream)).toEqual([true, true]);
    expect(existsSync(join(fixture, ".local", "containers", "storage"))).toBe(true);

    const sha = sha256Hex(LIBRARY);
    expect(new Uint8Array(readFileSync(library()))).toEqual(LIBRARY);
    expect(readFileSync(manifest(), "utf8")).toBe(manifestText(buildManifest(sha)));
    expect(lines).toEqual([
      "out: Building the image localhost/goop-native-build:1 with podman...",
      `out: Downloading ${archive.name}...`,
      `out: sha256 ok: ${archive.name}`,
      "out: Compiling sqlite3mc_amalgamation.c in a fresh podman container, without network...",
      "out: Toolchain: gcc-14 14.2.0-19, cpp-14 14.2.0-19, libgcc-14-dev 14.2.0-19, binutils 2.44-3, binutils-x86-64-linux-gnu 2.44-3, libc6-dev 2.41-12+deb13u4, unzip 6.0-29+deb13u1",
      `out: ${sha}  .local/build/native/linux-x64/libsqlite3mc.so`,
      "out: Wrote .local/build/native/manifest.json in 0m 30s.",
    ]);
  });

  test("each run downloads into a fresh folder of its own", async () => {
    await buildNative(deps(new FakeEngine()), archive);
    await buildNative(deps(new FakeEngine()), archive);
    expect(readdirSync(join(fixture, ".temp", "downloads"))).toHaveLength(2);
    expect(readdirSync(join(fixture, ".temp", "extract"))).toHaveLength(2);
  });

  test("an archive with another sha256 stops before the container runs", async () => {
    const engine = new FakeEngine();
    expect(await buildNative(deps(engine), SQLITE3MC_ARCHIVE)).toBe(1);
    expect(engine.podman().map((args) => args[0])).toEqual(["build"]);
    expect(lines.at(-1)).toBe(
      `err: sha256 mismatch for ${archive.name}: expected ${SQLITE3MC_ARCHIVE.sha256}, got ${archive.sha256}`,
    );
    expect(readdirSync(join(fixture, ".temp", "downloads"))).toHaveLength(1);
    const [folder] = readdirSync(join(fixture, ".temp", "downloads"));
    expect(readdirSync(join(fixture, ".temp", "downloads", folder ?? ""))).toEqual([]);
    expect(existsSync(library())).toBe(false);
    expect(existsSync(manifest())).toBe(false);
  });

  test("a failed download stops the build", async () => {
    const failing = async () => {
      throw new Error("HTTP 502");
    };
    expect(await buildNative(deps(new FakeEngine(), failing), archive)).toBe(1);
    expect(lines.at(-1)).toBe(`err: Could not download ${archive.name}: HTTP 502`);
    expect(existsSync(manifest())).toBe(false);
  });

  test("a failed image build stops before the download", async () => {
    const engine = new FakeEngine();
    engine.buildExitCode = 125;
    expect(await buildNative(deps(engine), archive)).toBe(1);
    expect(lines).toEqual([
      "out: Building the image localhost/goop-native-build:1 with podman...",
      "err: Could not build the image (podman build exited 125).",
    ]);
  });

  test("a failed container writes nothing", async () => {
    expect(await buildNative(deps(new FakeEngine({ exitCode: 1 })), archive)).toBe(1);
    expect(lines.at(-1)).toBe("err: The build container failed (podman run exited 1).");
    expect(existsSync(library())).toBe(false);
    expect(existsSync(manifest())).toBe(false);
  });

  test("another SQLite version in the source writes nothing", async () => {
    const source = '#define SQLITE_VERSION        "3.55.0"\n';
    expect(await buildNative(deps(new FakeEngine({ source })), archive)).toBe(1);
    expect(lines.at(-1)).toBe(
      "err: sqlite3mc_amalgamation.c declares SQLite 3.55.0, expected 3.54.0.",
    );
    expect(existsSync(library())).toBe(false);
  });

  test("another toolchain writes nothing", async () => {
    const toolchain = TOOLCHAIN_TEXT.replace("binutils 2.44-3", "binutils 2.45-1");
    expect(await buildNative(deps(new FakeEngine({ toolchain })), archive)).toBe(1);
    expect(lines.at(-1)).toBe(
      "err: The build image has another toolchain: binutils is 2.45-1, expected 2.44-3",
    );
    expect(existsSync(library())).toBe(false);
    expect(existsSync(manifest())).toBe(false);
  });
});
