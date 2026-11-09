import { describe, expect, test } from "bun:test";
import { BUN_RELEASES } from "@scripts/sandbox/model/bun-release";
import {
  GIT_ROOT_MARKER,
  repoFiles,
  repoFilesArgs,
  SUITE_PLANS,
  suiteCommand,
  suiteSummary,
} from "@scripts/sandbox/model/suite";

describe("the suite plan of each system", () => {
  test("names the Bun build, the native platform, the shell and where the uploads land, one entry per system", () => {
    expect(SUITE_PLANS).toEqual({
      windows: {
        bun: BUN_RELEASES["windows-x64"],
        native: "win32-x64",
        shell: "powershell",
        uploads: "C:\\goop",
      },
      debian: {
        bun: BUN_RELEASES["linux-x64"],
        native: "linux-x64",
        shell: "bash",
        uploads: "/home/goop/goop",
      },
    });
  });

  test("PowerShell puts the copied Bun first on PATH, requires the native libraries, installs, runs the suite and hands its exit code back", () => {
    expect(suiteCommand(SUITE_PLANS.windows)).toBe(
      "$env:Path = 'C:\\goop\\bun;' + $env:Path; $env:GOOP_REQUIRE_NATIVE = '1'; Set-Location C:\\goop\\repo; bun install --frozen-lockfile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; bun run test; exit $LASTEXITCODE",
    );
  });

  test("bash does the same, stopping at the first failing step", () => {
    expect(suiteCommand(SUITE_PLANS.debian)).toBe(
      'export PATH="/home/goop/goop/bun:$PATH" && export GOOP_REQUIRE_NATIVE=1 && cd /home/goop/goop/repo && bun install --frozen-lockfile && bun run test',
    );
  });
});

describe("the repo copy", () => {
  test("lists tracked files and untracked ones git does not ignore, NUL-separated", () => {
    expect(repoFilesArgs("/repo")).toEqual([
      "git",
      "-C",
      "/repo",
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ]);
  });

  test("reads git's list once per file, sorted, without empty names", () => {
    expect(repoFiles("src/b.ts\0package.json\0src/a ts.ts\0package.json\0")).toEqual([
      "package.json",
      "src/a ts.ts",
      "src/b.ts",
    ]);
    expect(repoFiles("")).toEqual([]);
  });

  test("marks its root with an empty .git folder, as tools that look for the git root expect", () => {
    expect(GIT_ROOT_MARKER).toBe(".git");
  });
});

describe("suiteSummary", () => {
  test("says whether the suite passed, with its exit code and duration", () => {
    expect(suiteSummary("windows", 0, 185_000)).toBe("The whole suite passed on windows in 3m 5s.");
    expect(suiteSummary("debian", 1, 61_000)).toBe(
      "The suite failed on debian with exit code 1 after 1m 1s.",
    );
    expect(suiteSummary("debian", 130, 2_000)).toBe(
      "The suite failed on debian with exit code 130 after 0m 2s.",
    );
  });
});
