import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "../../model/cli-args";

describe("parseCliArgs", () => {
  test("a missing or unknown command asks for the usage", () => {
    expect(parseCliArgs([])).toEqual({ kind: "usage" });
    expect(parseCliArgs(["nope"])).toEqual({ kind: "usage" });
    expect(parseCliArgs(["--help"])).toEqual({ kind: "usage" });
  });

  test("install and status take no arguments", () => {
    expect(parseCliArgs(["install"])).toEqual({ kind: "install" });
    expect(parseCliArgs(["status"])).toEqual({ kind: "status" });
    expect(parseCliArgs(["install", "now"])).toEqual({
      kind: "usage",
      error: "install takes no arguments.",
    });
    expect(parseCliArgs(["status", "-v"])).toEqual({
      kind: "usage",
      error: "status takes no arguments.",
    });
  });

  test("run takes the PowerShell command after --", () => {
    expect(parseCliArgs(["run", "--", "Get-Date"])).toEqual({
      kind: "run",
      copy: [],
      fetch: [],
      command: "Get-Date",
    });
  });

  test("run collects repeated --copy and --fetch before --", () => {
    expect(
      parseCliArgs([
        "run",
        "--copy",
        "src",
        "--fetch",
        "C:\\goop\\out.xml",
        "--copy",
        "package.json",
        "--fetch",
        "C:/goop/log.txt",
        "--",
        "bun",
        "test",
        "--copy",
      ]),
    ).toEqual({
      kind: "run",
      copy: ["src", "package.json"],
      fetch: ["C:\\goop\\out.xml", "C:/goop/log.txt"],
      command: "bun test --copy",
    });
  });

  test("run rejects a missing command, missing values and unknown options", () => {
    expect(parseCliArgs(["run"])).toEqual({
      kind: "usage",
      error: "run needs a PowerShell command after --.",
    });
    expect(parseCliArgs(["run", "--"])).toEqual({
      kind: "usage",
      error: "run needs a PowerShell command after --.",
    });
    expect(parseCliArgs(["run", "--copy"])).toEqual({
      kind: "usage",
      error: "--copy needs a value.",
    });
    expect(parseCliArgs(["run", "--bogus", "--", "x"])).toEqual({
      kind: "usage",
      error: "Unknown option for run: --bogus",
    });
  });

  test("--fetch only accepts an absolute guest path without spaces or quotes", () => {
    for (const bad of ["out.xml", "C:\\my files\\out.xml", "C:\\goop\\a';b", "\\\\server\\x"]) {
      expect(parseCliArgs(["run", "--fetch", bad, "--", "x"])).toEqual({
        kind: "usage",
        error: `--fetch needs an absolute guest path like C:\\goop\\out.xml, got: ${bad}`,
      });
    }
  });
});
