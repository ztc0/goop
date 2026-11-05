import { describe, expect, test } from "bun:test";
import { parseBuildArgs, USAGE } from "../../model/cli-args";

describe("native:build arguments", () => {
  test("no argument lets the sandbox's engine order choose", () => {
    expect(parseBuildArgs([])).toEqual({ engine: undefined });
  });

  test("--engine picks Podman or Docker", () => {
    expect(parseBuildArgs(["--engine", "podman"])).toEqual({ engine: "podman" });
    expect(parseBuildArgs(["--engine", "docker"])).toEqual({ engine: "docker" });
  });

  test("anything else is a usage error", () => {
    expect(parseBuildArgs(["--engine"])).toEqual({ error: "--engine needs a value." });
    expect(parseBuildArgs(["--engine", "lxc"])).toEqual({
      error: "Unknown --engine: lxc (expected podman or docker).",
    });
    expect(parseBuildArgs(["--engine", "podman", "--engine", "docker"])).toEqual({
      error: "--engine is given more than once.",
    });
    expect(parseBuildArgs(["linux"])).toEqual({ error: "Unknown argument: linux" });
  });

  test("the usage names the command, the option and the outputs", () => {
    expect(USAGE).toBe(`Usage: bun run native:build [--engine podman|docker]

Builds libsqlite3mc.so for linux-x64 in a fresh container from the pinned Debian image,
then writes .local/build/native/linux-x64/libsqlite3mc.so and .local/build/native/manifest.json.

Options:
  --engine <engine> podman or docker; by default Podman if installed, else Docker
`);
  });
});
