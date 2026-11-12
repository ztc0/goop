import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "@scripts/dev/model/cli-args";

describe("dev cli arguments", () => {
  test("every argument after goop goes to goop unchanged", () => {
    expect(parseCliArgs(["goop"])).toEqual({ kind: "goop", args: [] });
    expect(parseCliArgs(["goop", "--help", "daemon", "--", "logs"])).toEqual({
      kind: "goop",
      args: ["--help", "daemon", "--", "logs"],
    });
  });

  test("logs and stop take no arguments", () => {
    expect(parseCliArgs(["logs"])).toEqual({ kind: "logs" });
    expect(parseCliArgs(["stop"])).toEqual({ kind: "stop" });
    expect(parseCliArgs(["stop", "now"])).toEqual({
      kind: "usage",
      error: "stop takes no arguments.",
    });
  });

  test("a missing or unknown command is a usage error", () => {
    expect(parseCliArgs([])).toEqual({ kind: "usage", error: "Missing command." });
    expect(parseCliArgs(["start"])).toEqual({ kind: "usage", error: "Unknown command: start" });
  });
});
