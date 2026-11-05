// Doubles for the build service: an in-memory file system, a scripted process runner and
// downloads served from a table, so every step can fail on demand.
import { join } from "node:path";
import type { Output, ProcessRequest, ProcessResult, ProcessRunner } from "../../shared/containers";
import { sha256Hex } from "../../shared/download";
import { buildEngine } from "../model/engine";
import { nativeLibsPaths } from "../model/paths";
import type { BuildDeps, CosignPin, LibraryRecipe, NativeLibsFiles } from "../types/native-libs";

export const bytes = (text: string) => new TextEncoder().encode(text);
export const text = (content: Uint8Array | undefined) =>
  content === undefined ? undefined : new TextDecoder().decode(content);

export const ARCHIVE = bytes("zip bytes");
export const LIBRARY = bytes("ELF library");
export const SUMS = bytes(`${sha256Hex(ARCHIVE)}  test-1.0.zip\n`);
export const COSIGN_BYTES = bytes("cosign binary");
export const COSIGN_PIN: CosignPin = {
  name: "cosign-test",
  version: "v0.0.1",
  url: "https://example.test/cosign-test",
  sha256: sha256Hex(COSIGN_BYTES),
  maxBytes: 100,
};

export const RECIPE: LibraryRecipe = {
  name: "testlib",
  platform: "linux-x64",
  archive: {
    name: "test-1.0.zip",
    url: "https://example.test/test-1.0.zip",
    sha256: sha256Hex(ARCHIVE),
    maxBytes: 100,
  },
  signed: {
    list: { name: "SUMS", url: "https://example.test/SUMS", maxBytes: 10 },
    signature: { name: "SUMS.sig", url: "https://example.test/SUMS.sig", maxBytes: 10 },
    certificate: { name: "SUMS.pem", url: "https://example.test/SUMS.pem", maxBytes: 10 },
    identity: "https://example.test/wf.yml@refs/heads/main",
    issuer: "https://issuer.test",
  },
  image: "localhost/goop-native-libs-test:1",
  containerfile: "scripts/native-libs/testlib/Containerfile",
  toolchain: [{ name: "gcc", version: "1" }],
  environment: { LC_ALL: "C" },
  script: "build it",
  source: {
    file: "test.c",
    label: "Test",
    expected: "1.2.3",
    version: (source) => /VERSION "([^"]+)"/.exec(source)?.[1],
  },
  output: { file: "libtest.so", sha256: sha256Hex(LIBRARY), sqliteVersion: "3.54.0" },
};

export class FakeFiles implements NativeLibsFiles {
  readonly files = new Map<string, { content: Uint8Array; mode?: number }>();
  readonly directories: string[] = [];
  private count = 0;

  freshDirectory(parent: string, prefix: string): string {
    this.count += 1;
    const path = join(parent, `${prefix}${this.count}`);
    this.directories.push(path);
    return path;
  }
  makeDirectory(path: string): void {
    this.directories.push(path);
  }
  read(path: string): Uint8Array | undefined {
    return this.files.get(path)?.content;
  }
  writeNew(path: string, content: Uint8Array, mode?: number): void {
    if (this.files.has(path)) throw new Error(`${path} exists`);
    this.files.set(path, mode === undefined ? { content } : { content, mode });
  }
  /** Paths whose replacement fails, as a full disk or a read-only folder would. */
  readonly failReplace = new Set<string>();
  replace(path: string, content: Uint8Array): void {
    if (this.failReplace.has(path)) throw new Error(`cannot write ${path}`);
    this.files.set(path, { content });
  }
  remove(path: string): void {
    this.files.delete(path);
  }
  /** Paths below a folder, sorted. */
  below(folder: string): string[] {
    return [...this.files.keys()].filter((path) => path.startsWith(`${folder}/`)).sort();
  }
}

/** What the fake container writes, and what each engine or cosign call replies. */
export interface Scenario {
  toolchain?: string;
  source?: string;
  library?: Uint8Array;
  build?: Partial<ProcessResult>;
  run?: Partial<ProcessResult>;
  cosign?: Partial<ProcessResult>;
}

export class FakeRunner implements ProcessRunner {
  readonly calls: ProcessRequest[] = [];
  constructor(
    private readonly files: FakeFiles,
    private readonly scenario: Scenario,
  ) {}

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.calls.push(request);
    const done = (reply: Partial<ProcessResult> = {}) => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      ...reply,
    });
    const args = request.command.slice(7);
    if (request.command[0] !== "podman") return done(this.scenario.cosign);
    if (args[0] === "build") return done(this.scenario.build);
    const mount = (target: string) =>
      args.find((arg) => arg.endsWith(`:${target}`))?.slice(0, -target.length - 1) ?? "";
    const reply = done(this.scenario.run);
    if (reply.exitCode !== 0) return reply;
    const { toolchain = "gcc 1\n", source = '#define VERSION "1.2.3"\n' } = this.scenario;
    this.files.writeNew(join(mount("/build/src"), "test.c"), bytes(source));
    this.files.writeNew(join(mount("/build/out"), "toolchain.txt"), bytes(toolchain));
    this.files.writeNew(join(mount("/build/out"), "libtest.so"), this.scenario.library ?? LIBRARY);
    return reply;
  }

  /** The engine subcommands, without `podman` and its six storage flags. */
  engine(): string[][] {
    return this.calls
      .filter((call) => call.command[0] === "podman")
      .map((call) => call.command.slice(7));
  }
}

export class FakeOutput implements Output {
  readonly lines: string[] = [];
  info(line: string): void {
    this.lines.push(line);
  }
  error(line: string): void {
    this.lines.push(`error: ${line}`);
  }
}

export interface Harness {
  deps: BuildDeps;
  files: FakeFiles;
  runner: FakeRunner;
  output: FakeOutput;
  downloads: string[];
}

/** A build over fakes; `served` replaces or removes (undefined) a URL's bytes. */
export function harness(
  scenario: Scenario = {},
  served: Record<string, Uint8Array | undefined> = {},
): Harness {
  const files = new FakeFiles();
  const runner = new FakeRunner(files, scenario);
  const output = new FakeOutput();
  const downloads: string[] = [];
  const table: Record<string, Uint8Array | undefined> = {
    [RECIPE.archive.url]: ARCHIVE,
    [RECIPE.signed.list.url]: SUMS,
    [RECIPE.signed.signature.url]: bytes("sig"),
    [RECIPE.signed.certificate.url]: bytes("pem"),
    [COSIGN_PIN.url]: COSIGN_BYTES,
    ...served,
  };
  let clock = 1000;
  const paths = nativeLibsPaths("/repo");
  const deps: BuildDeps = {
    paths,
    engine: buildEngine("podman", paths.podman, 1000, 1000),
    runner,
    files,
    download: async (url) => {
      downloads.push(url);
      const content = table[url];
      if (content === undefined) throw new Error("HTTP 404");
      return content;
    },
    now: () => {
      const now = clock;
      clock += 2500;
      return now;
    },
    output,
  };
  return { deps, files, runner, output, downloads };
}
