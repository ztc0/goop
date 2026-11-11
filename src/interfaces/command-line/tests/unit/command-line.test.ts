import { describe, expect, test } from "bun:test";
import {
  parseCommandLine,
  platformProblem,
  USAGE,
} from "@/interfaces/command-line/model/command-line";

describe("parseCommandLine", () => {
  test("`goop` alone opens the TUI", () => {
    expect(parseCommandLine([])).toEqual({ kind: "tui" });
  });

  test("`goop daemon` runs the daemon", () => {
    expect(parseCommandLine(["daemon"])).toEqual({ kind: "daemon" });
  });

  test("`--help` and `-h` ask for the usage", () => {
    expect(parseCommandLine(["--help"])).toEqual({ kind: "help" });
    expect(parseCommandLine(["-h"])).toEqual({ kind: "help" });
  });

  test("an unknown command is refused, naming it", () => {
    expect(parseCommandLine(["deamon"])).toEqual({
      kind: "invalid",
      problem: 'Unknown command: "deamon"',
    });
  });

  test("an argument after a command is refused, naming the first one", () => {
    expect(parseCommandLine(["daemon", "--port", "1"])).toEqual({
      kind: "invalid",
      problem: 'Unknown command: "--port"',
    });
    expect(parseCommandLine(["--help", "daemon"])).toEqual({
      kind: "invalid",
      problem: 'Unknown command: "daemon"',
    });
  });

  test("a control character in the argument is shown escaped, never written raw", () => {
    expect(parseCommandLine(["\u001b[2Jx"])).toEqual({
      kind: "invalid",
      problem: 'Unknown command: "\\u001b[2Jx"',
    });
  });
});

describe("USAGE", () => {
  test("names both commands and the help option", () => {
    expect(USAGE).toBe(
      [
        "Usage:",
        "  goop          Open goop; the daemon must be running",
        "  goop daemon   Run the daemon, which owns the models, the queue and the database",
        "  goop --help   Show this help",
        "",
      ].join("\n"),
    );
  });
});

describe("platformProblem", () => {
  test("Windows is refused until its channel exists", () => {
    expect(platformProblem("win32")).toBe("goop does not run on Windows yet (daemon-ipc T5).");
  });

  test("Linux has none", () => {
    expect(platformProblem("linux")).toBeUndefined();
  });
});
