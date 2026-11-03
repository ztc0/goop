import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "../../model/cli-args";

const OS = ["--os", "windows"];

describe("parseCliArgs", () => {
  test("a missing or unknown command asks for the usage", () => {
    expect(parseCliArgs([])).toEqual({ kind: "usage" });
    expect(parseCliArgs(["nope"])).toEqual({ kind: "usage" });
    expect(parseCliArgs(["--help"])).toEqual({ kind: "usage" });
  });

  test("install and status take only --os", () => {
    expect(parseCliArgs(["install", ...OS])).toEqual({ kind: "install", os: "windows" });
    expect(parseCliArgs(["status", ...OS])).toEqual({ kind: "status", os: "windows" });
    expect(parseCliArgs(["install", "now"])).toEqual({
      kind: "usage",
      error: "install takes no arguments.",
    });
    expect(parseCliArgs(["status", ...OS, "-v"])).toEqual({
      kind: "usage",
      error: "status takes no arguments.",
    });
  });

  test("install, run and status require --os (S1)", () => {
    for (const command of ["install", "status"]) {
      expect(parseCliArgs([command])).toEqual({
        kind: "usage",
        error: `${command} needs --os windows or --os debian.`,
      });
    }
    expect(parseCliArgs(["run", "--", "Get-Date"])).toEqual({
      kind: "usage",
      error: "run needs --os windows or --os debian.",
    });
  });

  test("--os accepts windows and debian, and rejects anything else (S1)", () => {
    expect(parseCliArgs(["install", "--os", "debian"])).toEqual({ kind: "install", os: "debian" });
    expect(parseCliArgs(["run", "--os", "debian", "--", "uname"])).toEqual({
      kind: "run",
      os: "debian",
      copy: [],
      fetch: [],
      command: "uname",
    });
    for (const command of ["install", "status", "run"]) {
      expect(parseCliArgs([command, "--os", "macos", "--", "x"])).toEqual({
        kind: "usage",
        error: "Unknown --os: macos (expected windows or debian).",
      });
      expect(parseCliArgs([command, "--os"])).toEqual({
        kind: "usage",
        error: "--os needs a value.",
      });
      expect(parseCliArgs([command, ...OS, "--os", "debian", "--", "x"])).toEqual({
        kind: "usage",
        error: "--os is given more than once.",
      });
    }
  });

  test("--engine accepts podman and docker on every command, and rejects anything else (S3)", () => {
    expect(parseCliArgs(["status", ...OS, "--engine", "docker"])).toEqual({
      kind: "status",
      os: "windows",
      engine: "docker",
    });
    expect(parseCliArgs(["install", "--engine", "podman", ...OS])).toEqual({
      kind: "install",
      os: "windows",
      engine: "podman",
    });
    expect(parseCliArgs(["run", "--engine", "podman", ...OS, "--", "Get-Date"])).toEqual({
      kind: "run",
      os: "windows",
      engine: "podman",
      copy: [],
      fetch: [],
      command: "Get-Date",
    });
    for (const command of ["install", "status", "run"]) {
      expect(parseCliArgs([command, ...OS, "--engine", "lxc", "--", "x"])).toEqual({
        kind: "usage",
        error: "Unknown --engine: lxc (expected podman or docker).",
      });
      expect(parseCliArgs([command, ...OS, "--engine"])).toEqual({
        kind: "usage",
        error: "--engine needs a value.",
      });
      expect(
        parseCliArgs([command, ...OS, "--engine", "podman", "--engine", "docker", "--", "x"]),
      ).toEqual({ kind: "usage", error: "--engine is given more than once." });
    }
  });

  test("run takes the PowerShell command after --", () => {
    expect(parseCliArgs(["run", ...OS, "--", "Get-Date"])).toEqual({
      kind: "run",
      os: "windows",
      copy: [],
      fetch: [],
      command: "Get-Date",
    });
  });

  test("run also takes the command without --, since `bun run` drops the first --", () => {
    expect(parseCliArgs(["run", ...OS, "Write-Output hi;", "exit 3"])).toEqual({
      kind: "run",
      os: "windows",
      copy: [],
      fetch: [],
      command: "Write-Output hi; exit 3",
    });
    expect(parseCliArgs(["run", "--copy", "dist", ...OS, "Get-ChildItem C:\\goop"])).toEqual({
      kind: "run",
      os: "windows",
      copy: ["dist"],
      fetch: [],
      command: "Get-ChildItem C:\\goop",
    });
  });

  test("run collects repeated --copy and --fetch before --", () => {
    expect(
      parseCliArgs([
        "run",
        ...OS,
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
      os: "windows",
      copy: ["src", "package.json"],
      fetch: ["C:\\goop\\out.xml", "C:/goop/log.txt"],
      command: "bun test --copy",
    });
  });

  test("run rejects a missing command, missing values and unknown options", () => {
    expect(parseCliArgs(["run", ...OS])).toEqual({
      kind: "usage",
      error: "run needs a PowerShell command after --.",
    });
    expect(parseCliArgs(["run", ...OS, "--"])).toEqual({
      kind: "usage",
      error: "run needs a PowerShell command after --.",
    });
    expect(parseCliArgs(["run", ...OS, "--copy"])).toEqual({
      kind: "usage",
      error: "--copy needs a value.",
    });
    expect(parseCliArgs(["run", ...OS, "--bogus", "--", "x"])).toEqual({
      kind: "usage",
      error: "Unknown option for run: --bogus",
    });
  });

  test("run --os debian needs a shell command and takes absolute POSIX --fetch paths (S2)", () => {
    const DEBIAN = ["--os", "debian"];
    for (const args of [[], ["--"], ["--", "  "]]) {
      expect(parseCliArgs(["run", ...DEBIAN, ...args])).toEqual({
        kind: "usage",
        error: "run needs a shell command after --.",
      });
    }
    expect(
      parseCliArgs(["run", "--fetch", "/home/goop/goop/out.txt", ...DEBIAN, "--", "make test"]),
    ).toEqual({
      kind: "run",
      os: "debian",
      copy: [],
      fetch: ["/home/goop/goop/out.txt"],
      command: "make test",
    });
    for (const bad of ["out.txt", "/", "/my files/out.txt", "/a';b", "C:\\goop\\out.xml"]) {
      expect(parseCliArgs(["run", ...DEBIAN, "--fetch", bad, "--", "x"])).toEqual({
        kind: "usage",
        error: `--fetch needs an absolute container path like /home/goop/goop/out.txt, got: ${bad}`,
      });
    }
    // The Windows check still applies when --os windows comes after --fetch.
    expect(parseCliArgs(["run", "--fetch", "/tmp/x", ...OS, "--", "x"])).toEqual({
      kind: "usage",
      error: "--fetch needs an absolute guest path like C:\\goop\\out.xml, got: /tmp/x",
    });
  });

  test("--fetch only accepts an absolute guest path without spaces or quotes", () => {
    for (const bad of ["out.xml", "C:\\my files\\out.xml", "C:\\goop\\a';b", "\\\\server\\x"]) {
      expect(parseCliArgs(["run", ...OS, "--fetch", bad, "--", "x"])).toEqual({
        kind: "usage",
        error: `--fetch needs an absolute guest path like C:\\goop\\out.xml, got: ${bad}`,
      });
    }
  });
});
