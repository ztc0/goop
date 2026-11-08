import { describe, expect, test } from "bun:test";
import { parseBuildArgs, USAGE } from "../../model/cli-args";

const KNOWN = ["sqlite3mc"];
const parse = (...argv: string[]) => parseBuildArgs(argv, KNOWN);

describe("parseBuildArgs", () => {
  test("builds every library, with the detected engine and no signature check, by default", () => {
    expect(parse()).toEqual({ kind: "build", libraries: ["sqlite3mc"], verifySignature: false });
  });

  test("takes a library, --engine and --verify-signature in any order", () => {
    expect(parse("--verify-signature", "sqlite3mc", "--engine", "docker")).toEqual({
      kind: "build",
      libraries: ["sqlite3mc"],
      engine: "docker",
      verifySignature: true,
    });
    expect(parse("--engine", "podman")).toEqual({
      kind: "build",
      libraries: ["sqlite3mc"],
      engine: "podman",
      verifySignature: false,
    });
  });

  test("--target builds one platform of each library", () => {
    expect(parse("--target", "win32-x64")).toEqual({
      kind: "build",
      libraries: ["sqlite3mc"],
      target: "win32-x64",
      verifySignature: false,
    });
    expect(parse("sqlite3mc", "--engine", "podman", "--target", "linux-x64")).toEqual({
      kind: "build",
      libraries: ["sqlite3mc"],
      target: "linux-x64",
      engine: "podman",
      verifySignature: false,
    });
  });

  test("--target refuses another platform, a missing value and a second --target", () => {
    expect(parse("--target", "darwin-arm64")).toEqual({
      kind: "usage",
      error: "Unknown --target: darwin-arm64 (expected linux-x64 or win32-x64).",
    });
    expect(parse("--target")).toEqual({ kind: "usage", error: "--target needs a value." });
    expect(parse("--target", "linux-x64", "--target", "win32-x64")).toEqual({
      kind: "usage",
      error: "--target is given more than once.",
    });
  });

  test("shows the help for -h and --help", () => {
    expect(parse("-h")).toEqual({ kind: "help" });
    expect(parse("sqlite3mc", "--help")).toEqual({ kind: "help" });
  });

  test("refuses what it does not know", () => {
    expect(parse("sqlite-vec")).toEqual({
      kind: "usage",
      error: "Unknown library: sqlite-vec (expected sqlite3mc).",
    });
    expect(parse("--fast")).toEqual({ kind: "usage", error: "Unknown option: --fast" });
    expect(parse("--engine=podman")).toEqual({
      kind: "usage",
      error: "Unknown option: --engine=podman",
    });
    expect(parse("--engine", "lxc")).toEqual({
      kind: "usage",
      error: "Unknown --engine: lxc (expected podman or docker).",
    });
  });

  test("refuses a missing value and anything given twice", () => {
    expect(parse("--engine")).toEqual({ kind: "usage", error: "--engine needs a value." });
    expect(parse("--engine", "podman", "--engine", "docker")).toEqual({
      kind: "usage",
      error: "--engine is given more than once.",
    });
    expect(parse("--verify-signature", "--verify-signature")).toEqual({
      kind: "usage",
      error: "--verify-signature is given more than once.",
    });
    expect(parse("sqlite3mc", "sqlite3mc")).toEqual({
      kind: "usage",
      error: "sqlite3mc is given more than once.",
    });
  });

  test("the usage names the command, the library and every option", () => {
    expect(USAGE).toStartWith(
      "Usage: bun run native-libs:build [<library>...] [--target linux-x64|win32-x64] [--engine podman|docker] [--verify-signature]\n",
    );
    for (const word of [
      "sqlite3mc",
      "for linux-x64 and win32-x64",
      "--target <platform>",
      "--engine <engine>",
      "--verify-signature",
      "--help",
    ]) {
      expect(USAGE).toContain(word);
    }
  });
});
