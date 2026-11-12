import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { defaultBuild, notBuilt, parseBuildArgs, USAGE } from "@scripts/build/model/build";
import { buildExecutable } from "@scripts/build/services/build";
import type { BuildDeps, CompileRequest } from "@scripts/build/types/build";
import {
  type BuiltNativeLibraryOptions,
  NativeLibraryError,
  NativeManifestError,
} from "@/shared/vault";

const ROOT = "/repo";
const NATIVE = join(ROOT, ".local", "build", "native");
const SO = join(NATIVE, "linux-x64", "libsqlite3mc.so");
const REQUEST = { root: ROOT, platform: "linux-x64" as const, ...defaultBuild(ROOT) };

/** Doubles that record the checks asked for, the compile request and every line printed. */
function fakes(verify: (options: BuiltNativeLibraryOptions) => Promise<string>) {
  const checks: BuiltNativeLibraryOptions[] = [];
  const compiles: CompileRequest[] = [];
  const info: string[] = [];
  const errors: string[] = [];
  let compileResult: Awaited<ReturnType<BuildDeps["compiler"]["compile"]>> = {
    ok: true,
    path: REQUEST.outfile,
  };
  const deps: BuildDeps = {
    verify: async (options) => {
      checks.push(options);
      return verify(options);
    },
    compiler: {
      compile: async (request) => {
        compiles.push(request);
        return compileResult;
      },
    },
    output: { info: (line) => info.push(line), error: (line) => errors.push(line) },
  };
  return {
    deps,
    checks,
    compiles,
    info,
    errors,
    failCompile: (error: string) => {
      compileResult = { ok: false, error };
    },
  };
}

describe("bun run build (S6)", () => {
  test("by default it compiles src/main.ts into dist/goop, as before", () => {
    expect(defaultBuild(ROOT)).toEqual({
      entry: join(ROOT, "src", "main.ts"),
      outfile: join(ROOT, "dist", "goop"),
    });
  });

  test("it takes no arguments", () => {
    expect(parseBuildArgs([])).toEqual({ kind: "build" });
    expect(parseBuildArgs(["--target", "win32-x64"])).toEqual({
      kind: "usage",
      error: "Unknown argument: --target",
    });
    expect(USAGE).toBe("Usage: bun run build\n");
  });

  test("checks the platform's library against the manifest, then embeds both", async () => {
    const run = fakes(async () => SO);

    expect(await buildExecutable(run.deps, REQUEST)).toBe(0);

    expect(run.checks).toEqual([{ folder: NATIVE, name: "sqlite3mc", platform: "linux-x64" }]);
    expect(run.compiles).toEqual([
      {
        entry: REQUEST.entry,
        outfile: REQUEST.outfile,
        files: [join(NATIVE, "manifest.json"), SO],
      },
    ]);
    expect(run.info).toEqual([
      "Built dist/goop for linux-x64 with sqlite3mc (libsqlite3mc.so) and the native manifest embedded.",
    ]);
    expect(run.errors).toEqual([]);
  });

  test.each([
    [
      "a missing manifest",
      new NativeLibraryError(
        `The native library manifest is missing from ${join(NATIVE, "manifest.json")}. Build the libraries with: bun run build:native`,
      ),
    ],
    [
      "a library that does not match its pin",
      new NativeLibraryError(
        "The native library sqlite3mc (libsqlite3mc.so) does not match its pinned sha256 in /x: expected aaa, got bbb. goop did not load it.",
      ),
    ],
    [
      "a manifest without this platform",
      new NativeManifestError("This build of goop has no pinned sqlite3mc for linux-x64."),
    ],
  ])("refuses %s, names the build command and compiles nothing", async (_, error) => {
    const run = fakes(() => Promise.reject(error));

    expect(await buildExecutable(run.deps, REQUEST)).toBe(1);

    expect(run.errors).toEqual([error.message, notBuilt("linux-x64")]);
    expect(notBuilt("linux-x64")).toBe(
      "goop was not built: run `bun run build:native --target linux-x64` first.",
    );
    expect(run.compiles).toEqual([]);
    expect(run.info).toEqual([]);
  });

  test("an unexpected error is not hidden as a missing build", async () => {
    const run = fakes(() => Promise.reject(new Error("EACCES: permission denied")));

    await expect(buildExecutable(run.deps, REQUEST)).rejects.toThrow("EACCES: permission denied");
    expect(run.compiles).toEqual([]);
  });

  test("a failed compile prints Bun's error and exits 1", async () => {
    const run = fakes(async () => SO);
    run.failCompile('Could not resolve: "@/missing"');

    expect(await buildExecutable(run.deps, REQUEST)).toBe(1);

    expect(run.errors).toEqual([
      'Could not resolve: "@/missing"',
      "bun build failed: goop was not built.",
    ]);
    expect(run.info).toEqual([]);
  });
});
