import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { nodeFileStore } from "@scripts/sandbox/adapters/file-store";
import { createGuestShell } from "@scripts/sandbox/adapters/guest-shell";
import { createPodmanEngine } from "@scripts/sandbox/adapters/podman";
import { BUN_RELEASES, MAX_BUN_ZIP_BYTES, shasumsUrl } from "@scripts/sandbox/model/bun-release";
import { sandboxPaths } from "@scripts/sandbox/model/paths";
import { SUITE_PLANS, suiteCommand } from "@scripts/sandbox/model/suite";
import { runSuite } from "@scripts/sandbox/services/suite";
import { describeOnLinuxHost } from "@scripts/sandbox/tests/linux-host";
import { zipFixture } from "@scripts/sandbox/tests/zip-fixture";
import type { SuiteDeps } from "@scripts/sandbox/types/sandbox";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@scripts/shared/containers";
import { sha256Hex } from "@scripts/shared/download";

const repo = resolve(import.meta.dir, "..", "..", "..", "..");
const NAME = "goop-debian-run-r1";
const IMAGE = "localhost/goop-sandbox-debian:2";
const BINARY = new TextEncoder().encode("fake bun binary\n".repeat(64));
const ZIP = zipFixture([
  { name: "bun-linux-x64/", content: new Uint8Array() },
  { name: "bun-linux-x64/bun", content: BINARY, deflate: true },
]);
const RELEASE = {
  ...BUN_RELEASES["linux-x64"],
  sha256: sha256Hex(ZIP),
  binarySha256: sha256Hex(BINARY),
};
const SHASUMS = `${"0".repeat(64)}  bun-linux-x64-baseline.zip\n${sha256Hex(ZIP)}  bun-linux-x64.zip\n`;
const CACHE = `.local/cache/sandbox-bun/1.4.2-${sha256Hex(ZIP).slice(0, 16)}/bun`;

class FakeRunner implements ProcessRunner {
  readonly calls: ProcessRequest[] = [];
  constructor(private readonly reply: (request: ProcessRequest) => Partial<ProcessResult>) {}

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.calls.push(request);
    return { exitCode: 0, stdout: "", stderr: "", ...this.reply(request) };
  }

  podman(): string[][] {
    return this.calls
      .filter((call) => call.command[0] === "podman")
      .map((call) => call.command.slice(7));
  }
}

let fixture: string;
let lines: string[];
let downloads: [string, number][];
/** What each `podman cp` or `scp` found in the staged copy when it ran. */
let staged: Record<string, string[]>;

beforeEach(() => {
  fixture = join(repo, ".temp", "tests", `sandbox-suite-${crypto.randomUUID()}`);
  mkdirSync(join(fixture, "src"), { recursive: true });
  writeFileSync(join(fixture, "package.json"), '{ "packageManager": "bun@1.4.2" }\n');
  writeFileSync(join(fixture, "src", "a.ts"), "export {};\n");
  lines = [];
  downloads = [];
  staged = {};
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

/** Files, and empty folders with a trailing slash, relative to the path. */
function listTree(path: string): string[] {
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((entry) => statSync(entry).isFile() || readdirSync(entry).length === 0)
    .map((entry) => entry.slice(path.length + 1) + (statSync(entry).isFile() ? "" : "/"))
    .sort();
}

function runner(replies: (request: ProcessRequest) => Partial<ProcessResult> = () => ({})) {
  return new FakeRunner((request) => {
    const [program, ...args] = request.command;
    if (program === "git") return { stdout: "package.json\0src/a.ts\0src/deleted.ts\0" };
    // `podman cp <local> <container>:<dir>` and `scp ... <local> <guest>:<dir>`.
    const local = args.at(-2);
    if ((args.includes("cp") || program === "scp") && local?.includes("sandbox-test")) {
      staged[local.split("/").at(-1) ?? ""] = listTree(local);
    }
    if (args.includes("is-system-running")) return { stdout: "running\n" };
    if (program === "ssh" && args.at(-1) === "echo ok") return { stdout: "ok\n" };
    return replies(request);
  });
}

function deps(fake: FakeRunner, files: Record<string, Uint8Array | string>): SuiteDeps {
  const paths = sandboxPaths(fixture);
  return {
    paths,
    engine: createPodmanEngine(fake, paths),
    guest: createGuestShell(fake, paths),
    files: nodeFileStore,
    clock: { now: () => 0, sleep: async () => {} },
    output: {
      info: (line) => lines.push(`out: ${line}`),
      error: (line) => lines.push(`err: ${line}`),
    },
    random: { bytes: (count) => new Uint8Array(count).fill(7) },
    signal: new AbortController().signal,
    terminal: false,
    runner: fake,
    download: async (url, maxBytes) => {
      downloads.push([url, maxBytes]);
      const body = files[url];
      if (body === undefined) throw new Error("HTTP 404");
      return typeof body === "string" ? new TextEncoder().encode(body) : body;
    },
  };
}

const RELEASE_FILES = { [shasumsUrl("1.4.2")]: SHASUMS, [RELEASE.url]: ZIP };
const PLANS = { ...SUITE_PLANS, debian: { ...SUITE_PLANS.debian, bun: RELEASE } };

describeOnLinuxHost("runSuite on debian (T8)", () => {
  test("downloads and checks the pinned Bun, caches it, runs the suite in a copy and returns its exit code", async () => {
    const fake = runner((request) => (request.command.includes("-lc") ? { exitCode: 3 } : {}));

    const code = await runSuite(deps(fake, RELEASE_FILES), "debian", "r1", PLANS);

    const staging = join(fixture, ".temp", "sandbox-test", "r1");
    expect(code).toBe(3);
    expect(downloads).toEqual([
      [shasumsUrl("1.4.2"), 64 * 1024],
      [RELEASE.url, MAX_BUN_ZIP_BYTES],
    ]);
    expect(readFileSync(join(fixture, CACHE))).toEqual(Buffer.from(BINARY));
    expect(statSync(join(fixture, CACHE)).mode & 0o777).toBe(0o755);
    const [download = ""] = readdirSync(join(fixture, ".temp", "downloads"));
    expect(download).toStartWith("bun-");
    expect(readdirSync(join(fixture, ".temp", "downloads", download))).toEqual([
      "bun-linux-x64.zip",
    ]);
    expect(
      fake.calls.filter((call) => call.command[0] === "git").map((call) => call.command),
    ).toEqual([
      ["git", "-C", fixture, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    ]);
    expect(fake.podman()).toEqual([
      ["image", "inspect", "--format", "{{.Size}}", IMAGE],
      ["image", "inspect", "--format", "{{.Size}}", IMAGE],
      ["run", "-d", "--name", NAME, "--systemd=always", IMAGE],
      ["exec", NAME, "timeout", "30", "systemctl", "is-system-running", "--wait"],
      ["cp", join(staging, "repo"), `${NAME}:/home/goop/goop/`],
      ["cp", join(staging, "bun"), `${NAME}:/home/goop/goop/`],
      ["exec", NAME, "chown", "-R", "goop:goop", "/home/goop/goop"],
      [
        "exec",
        "--user",
        "goop",
        "--workdir",
        "/home/goop/goop",
        "--env",
        "XDG_RUNTIME_DIR=/run/user/1000",
        "--env",
        "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
        NAME,
        "bash",
        "-lc",
        suiteCommand(SUITE_PLANS.debian),
      ],
      ["rm", "--force", "--time", "10", NAME],
    ]);
    // Only the files git lists and that exist, never .local/, .temp/ or node_modules/.
    expect(staged).toEqual({ repo: [".git/", "package.json", "src/a.ts"], bun: ["bun"] });
    expect(existsSync(staging)).toBe(false);
    expect(lines).toEqual([
      "out: Downloading Bun 1.4.2 (bun-linux-x64.zip) from GitHub...",
      `out: sha256 ok: bun-linux-x64.zip and bun-linux-x64/bun, kept in ${CACHE}`,
      "out: Copying 2 repo files and Bun 1.4.2 into .temp/sandbox-test/r1/...",
      `out: Starting ${NAME}...`,
      "out: Waiting for systemd...",
      "out: systemd is running.",
      "out: Copying .temp/sandbox-test/r1/repo to /home/goop/goop/...",
      "out: Copying .temp/sandbox-test/r1/bun to /home/goop/goop/...",
      `out: Removing ${NAME}...`,
      "err: The suite failed on debian with exit code 3 after 0m 0s.",
    ]);
  });

  test("a second run uses the cached Bun after checking its sha256, without downloading", async () => {
    await runSuite(deps(runner(), RELEASE_FILES), "debian", "r1", PLANS);
    downloads = [];
    lines = [];

    const code = await runSuite(deps(runner(), RELEASE_FILES), "debian", "r2", PLANS);

    expect(code).toBe(0);
    expect(downloads).toEqual([]);
    expect(lines[0]).toBe(`out: Using Bun 1.4.2 from ${CACHE} (sha256 ok).`);
    expect(lines.at(-1)).toBe("out: The whole suite passed on debian in 0m 0s.");
  });

  test("a cached Bun with another sha256 is downloaded again", async () => {
    mkdirSync(join(fixture, CACHE, ".."), { recursive: true });
    writeFileSync(join(fixture, CACHE), "tampered");

    const code = await runSuite(deps(runner(), RELEASE_FILES), "debian", "r1", PLANS);

    expect(code).toBe(0);
    expect(downloads).toHaveLength(2);
    expect(readFileSync(join(fixture, CACHE))).toEqual(Buffer.from(BINARY));
  });

  test("a changed upstream asset is refused: nothing is cached and no container starts", async () => {
    const changed = `${"f".repeat(64)}  bun-linux-x64.zip\n`;
    const fake = runner();

    const code = await runSuite(
      deps(fake, { ...RELEASE_FILES, [shasumsUrl("1.4.2")]: changed }),
      "debian",
      "r1",
      PLANS,
    );

    expect(code).toBe(1);
    expect(lines).toEqual([
      "out: Downloading Bun 1.4.2 (bun-linux-x64.zip) from GitHub...",
      `err: SHASUMS256.txt of Bun 1.4.2 lists ${"f".repeat(64)} for bun-linux-x64.zip, but the pinned sha256 is ${RELEASE.sha256}; refusing it.`,
    ]);
    expect(existsSync(join(fixture, CACHE))).toBe(false);
    expect(fake.podman()).toEqual([["image", "inspect", "--format", "{{.Size}}", IMAGE]]);
    expect(fake.calls.some((call) => call.command[0] === "git")).toBe(false);
  });

  test("a downloaded archive without the pinned sha256 is refused and never written", async () => {
    const other = zipFixture([{ name: "bun-linux-x64/bun", content: new Uint8Array([1]) }]);

    const code = await runSuite(
      deps(runner(), { ...RELEASE_FILES, [RELEASE.url]: other }),
      "debian",
      "r1",
      PLANS,
    );

    expect(code).toBe(1);
    expect(lines.at(-1)).toBe(
      `err: sha256 mismatch for bun-linux-x64.zip: expected ${RELEASE.sha256}, got ${sha256Hex(other)}`,
    );
    const [download = ""] = readdirSync(join(fixture, ".temp", "downloads"));
    expect(readdirSync(join(fixture, ".temp", "downloads", download))).toEqual([]);
    expect(existsSync(join(fixture, CACHE))).toBe(false);
  });

  test("a failed download names the URL and exits 1", async () => {
    const code = await runSuite(deps(runner(), {}), "debian", "r1", PLANS);

    expect(code).toBe(1);
    expect(lines.at(-1)).toBe(`err: Could not download ${shasumsUrl("1.4.2")}: HTTP 404`);
  });

  test("another Bun in package.json stops before downloading anything", async () => {
    writeFileSync(join(fixture, "package.json"), '{ "packageManager": "bun@1.4.3" }\n');
    const fake = runner();

    const code = await runSuite(deps(fake, RELEASE_FILES), "debian", "r1", PLANS);

    expect(code).toBe(1);
    expect(downloads).toEqual([]);
    expect(lines).toEqual([
      "err: package.json pins bun@1.4.3, but the sandbox has hashes for Bun 1.4.2 only; pin the new release in scripts/sandbox/model/bun-release.ts.",
    ]);
  });

  test("without the Debian image it exits 1 with the install hint before downloading", async () => {
    const fake = runner((request) =>
      request.command.includes("inspect") ? { exitCode: 125, stderr: "no such image" } : {},
    );

    const code = await runSuite(deps(fake, RELEASE_FILES), "debian", "r1", PLANS);

    expect(code).toBe(1);
    expect(downloads).toEqual([]);
    expect(lines).toEqual(["err: No Debian image: run `bun run sandbox:install debian` first."]);
  });
});

describeOnLinuxHost("runSuite on windows (T8)", () => {
  const WINDOWS_BINARY = new TextEncoder().encode("fake bun.exe");
  const WINDOWS_ZIP = zipFixture([
    { name: "bun-windows-x64/bun.exe", content: WINDOWS_BINARY, deflate: true },
  ]);
  const WINDOWS = {
    ...BUN_RELEASES["windows-x64"],
    sha256: sha256Hex(WINDOWS_ZIP),
    binarySha256: sha256Hex(WINDOWS_BINARY),
  };
  const FILES = {
    [shasumsUrl("1.4.2")]: `${sha256Hex(WINDOWS_ZIP)}  bun-windows-x64.zip\n`,
    [WINDOWS.url]: WINDOWS_ZIP,
  };

  test("uploads the copy and Bun to C:\\goop\\, runs the PowerShell suite and returns its exit code", async () => {
    const base = join(fixture, ".local", "windows", "base");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "data.qcow2"), "base-disk");
    const fake = runner();

    const code = await runSuite(deps(fake, FILES), "windows", "r1", {
      ...SUITE_PLANS,
      windows: { ...SUITE_PLANS.windows, bun: WINDOWS },
    });

    const staging = join(fixture, ".temp", "sandbox-test", "r1");
    expect(code).toBe(0);
    const uploads = fake.calls.filter((call) => call.command[0] === "scp");
    expect(uploads.map((call) => call.command.slice(-2))).toEqual([
      [join(staging, "repo"), "goop@127.0.0.1:C:/goop/"],
      [join(staging, "bun"), "goop@127.0.0.1:C:/goop/"],
    ]);
    expect(staged).toEqual({ repo: [".git/", "package.json", "src/a.ts"], bun: ["bun.exe"] });
    const suite = fake.calls.find((call) => call.stdin !== undefined);
    expect(suite?.stdin).toBe(`${suiteCommand(SUITE_PLANS.windows)}\r\n`);
    expect(suite?.stream).toBe(true);
    expect(existsSync(staging)).toBe(false);
    expect(lines.at(-1)).toBe("out: The whole suite passed on windows in 0m 0s.");
  });

  test("without a base it exits 1 with the install hint before downloading", async () => {
    const code = await runSuite(deps(runner(), FILES), "windows", "r1");

    expect(code).toBe(1);
    expect(downloads).toEqual([]);
    expect(lines).toEqual(["err: No Windows base: run `bun run sandbox:install windows` first."]);
  });
});
