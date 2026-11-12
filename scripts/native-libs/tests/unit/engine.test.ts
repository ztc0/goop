import { describe, expect, test } from "bun:test";
import { buildEngine, runArgs } from "@scripts/native-libs/model/engine";
import { nativeLibsPaths } from "@scripts/native-libs/model/paths";
import type { LibraryRecipe } from "@scripts/native-libs/types/native-libs";

// build:native runs on Linux x86_64 only; these suites compare POSIX host paths.
const describeOnLinuxHost = describe.skipIf(process.platform === "win32");

const paths = nativeLibsPaths("/repo");
const recipe: Pick<LibraryRecipe, "image" | "environment" | "script"> = {
  image: "localhost/goop-native-libs-test:1",
  environment: { SOURCE_DATE_EPOCH: "1", LC_ALL: "C" },
  script: "set -eu\ntrue",
};
const dirs = { download: "/repo/.temp/downloads/d", extract: "/repo/.temp/extract/e", out: "/o" };

describeOnLinuxHost("nativeLibsPaths", () => {
  test("keeps every path inside the repo, with Podman's storage shared with the sandbox", () => {
    expect(paths).toEqual({
      root: "/repo",
      output: "/repo/.local/build/native",
      manifest: "/repo/.local/build/native/manifest.json",
      downloads: "/repo/.temp/downloads",
      extract: "/repo/.temp/extract",
      staging: "/repo/.temp/tmp",
      podman: {
        containerStorage: "/repo/.local/containers/storage",
        containerRunRoot: "/repo/.temp/containers/run",
        containerTmp: "/repo/.temp/containers/tmp",
      },
    });
  });
});

describeOnLinuxHost("buildEngine", () => {
  test("Podman gets the repo-local storage flags, environment and folders", () => {
    expect(buildEngine("podman", paths.podman, 1000, 1000)).toEqual({
      name: "podman",
      command: [
        "podman",
        "--root",
        "/repo/.local/containers/storage",
        "--runroot",
        "/repo/.temp/containers/run",
        "--tmpdir",
        "/repo/.temp/containers/tmp",
      ],
      env: { TMPDIR: "/repo/.temp/containers/tmp" },
      directories: [
        "/repo/.local/containers/storage",
        "/repo/.temp/containers/run",
        "/repo/.temp/containers/tmp",
      ],
    });
  });

  test("Docker runs the build as the host user", () => {
    expect(buildEngine("docker", paths.podman, 1000, 1001)).toEqual({
      name: "docker",
      command: ["docker"],
      env: {},
      directories: [],
      user: "1000:1001",
    });
  });
});

describe("runArgs", () => {
  test("a throwaway container: no network, no capabilities, read-only root and input", () => {
    expect(runArgs(buildEngine("podman", paths.podman, 1000, 1000), recipe, dirs)).toEqual([
      "run",
      "--rm",
      "--network=none",
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--cap-drop=all",
      "--env",
      "SOURCE_DATE_EPOCH=1",
      "--env",
      "LC_ALL=C",
      "-v",
      "/repo/.temp/downloads/d:/build/input:ro",
      "-v",
      "/repo/.temp/extract/e:/build/src",
      "-v",
      "/o:/build/out",
      "localhost/goop-native-libs-test:1",
      "sh",
      "-c",
      "set -eu\ntrue",
    ]);
  });

  test("with Docker the container runs as the host user", () => {
    const args = runArgs(buildEngine("docker", paths.podman, 1000, 1001), recipe, dirs);
    expect(args.slice(-6)).toEqual([
      "--user",
      "1000:1001",
      "localhost/goop-native-libs-test:1",
      "sh",
      "-c",
      "set -eu\ntrue",
    ]);
  });
});
