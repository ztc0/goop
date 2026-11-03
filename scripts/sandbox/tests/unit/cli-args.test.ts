import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "../../model/cli-args";

const OS = ["windows"];

describe("parseCliArgs", () => {
  test("a missing or unknown command asks for the usage", () => {
    expect(parseCliArgs([])).toEqual({ kind: "usage" });
    expect(parseCliArgs(["nope"])).toEqual({ kind: "usage" });
    expect(parseCliArgs(["--help"])).toEqual({ kind: "usage" });
  });

  test("install and status take the system and nothing else (S1)", () => {
    expect(parseCliArgs(["install", ...OS])).toEqual({ kind: "install", os: "windows" });
    expect(parseCliArgs(["status", ...OS])).toEqual({ kind: "status", os: "windows" });
    expect(parseCliArgs(["install", "debian"])).toEqual({ kind: "install", os: "debian" });
    expect(parseCliArgs(["status", "debian"])).toEqual({ kind: "status", os: "debian" });
    expect(parseCliArgs(["install", "debian", "systemctl --version"])).toEqual({
      kind: "usage",
      error: "install takes no command; to run one, use: bun run sandbox:run <system> <command>",
    });
    expect(parseCliArgs(["status", ...OS, "--engine", "podman", "-v"])).toEqual({
      kind: "usage",
      error: "status takes no command; to run one, use: bun run sandbox:run <system> <command>",
    });
  });

  test("install, run and status need the system first (S1)", () => {
    for (const command of ["install", "status", "run"]) {
      for (const rest of [[], ["--engine", "podman", "debian"]]) {
        expect(parseCliArgs([command, ...rest])).toEqual({
          kind: "usage",
          error: `${command} needs the system first: windows or debian.`,
        });
      }
    }
    expect(parseCliArgs(["run", "--", "Get-Date"])).toEqual({
      kind: "usage",
      error: "run needs the system first: windows or debian.",
    });
  });

  test("the system is windows or debian, and anything else is rejected (S1)", () => {
    expect(parseCliArgs(["run", "debian", "uname", "-a"])).toEqual({
      kind: "run",
      os: "debian",
      copy: [],
      fetch: [],
      command: "uname -a",
    });
    for (const command of ["install", "status", "run"]) {
      expect(parseCliArgs([command, "macos", "--", "x"])).toEqual({
        kind: "usage",
        error: "Unknown system: macos (expected windows or debian).",
      });
    }
  });

  test("--os is rejected with the new form, wherever it is among the options (S1)", () => {
    const error =
      "--os was replaced: write the system right after the command, like: bun run sandbox:run debian uname -a";
    for (const command of ["install", "status", "run"]) {
      for (const args of [
        ["--os", "debian"],
        ["--os"],
        ["debian", "--os", "debian"],
        ["debian", "--engine", "podman", "--os", "debian", "--", "x"],
      ]) {
        expect(parseCliArgs([command, ...args])).toEqual({ kind: "usage", error });
      }
    }
    // After the command starts, --os is part of the command text.
    expect(parseCliArgs(["run", "debian", "tool", "--os", "x"])).toEqual({
      kind: "run",
      os: "debian",
      copy: [],
      fetch: [],
      command: "tool --os x",
    });
  });

  test("--engine accepts podman and docker on every command, and rejects anything else (S3)", () => {
    expect(parseCliArgs(["status", ...OS, "--engine", "docker"])).toEqual({
      kind: "status",
      os: "windows",
      engine: "docker",
    });
    expect(parseCliArgs(["install", ...OS, "--engine", "podman"])).toEqual({
      kind: "install",
      os: "windows",
      engine: "podman",
    });
    expect(parseCliArgs(["run", ...OS, "--engine", "podman", "--", "Get-Date"])).toEqual({
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

  test("run takes the command after -- or without it, with --engine before it (S1)", () => {
    for (const args of [
      ["uname", "-a"],
      ["--", "uname", "-a"],
    ]) {
      expect(parseCliArgs(["run", "debian", "--engine", "podman", ...args])).toEqual({
        kind: "run",
        os: "debian",
        engine: "podman",
        copy: [],
        fetch: [],
        command: "uname -a",
      });
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
    expect(parseCliArgs(["run", ...OS, "--copy", "dist", "Get-ChildItem C:\\goop"])).toEqual({
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
      error: "run needs a PowerShell command.",
    });
    expect(parseCliArgs(["run", ...OS, "--"])).toEqual({
      kind: "usage",
      error: "run needs a PowerShell command.",
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

  test("run debian without a command asks for a shell, with --copy and --fetch kept (S2)", () => {
    const DEBIAN = ["debian"];
    for (const args of [[], ["--"], ["--", "  "]]) {
      expect(parseCliArgs(["run", ...DEBIAN, ...args])).toEqual({
        kind: "run",
        os: "debian",
        copy: [],
        fetch: [],
        command: "",
      });
    }
    expect(
      parseCliArgs(["run", ...DEBIAN, "--copy", "src", "--fetch", "/home/goop/goop/out.txt"]),
    ).toEqual({
      kind: "run",
      os: "debian",
      copy: ["src"],
      fetch: ["/home/goop/goop/out.txt"],
      command: "",
    });
  });

  test("run debian takes absolute POSIX --fetch paths (S2)", () => {
    const DEBIAN = ["debian"];
    expect(
      parseCliArgs(["run", ...DEBIAN, "--fetch", "/home/goop/goop/out.txt", "--", "make test"]),
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
    // A Debian path is not a Windows guest path.
    expect(parseCliArgs(["run", ...OS, "--fetch", "/tmp/x", "--", "x"])).toEqual({
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
