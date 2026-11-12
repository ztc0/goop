import { describe, expect, test } from "bun:test";
import {
  CONTAINER,
  followLogsArgs,
  forceRemoveArgs,
  goopArgs,
  hostFolders,
  IMAGE,
  isRunning,
  runningArgs,
  socketCheckArgs,
  startArgs,
} from "@scripts/dev/model/container-args";
import { devPaths } from "@scripts/dev/model/paths";

const paths = devPaths("/repo");

describe("dev paths", () => {
  test("keep everything inside the repo, Podman storage where the sandbox keeps it", () => {
    expect(paths).toEqual({
      root: "/repo",
      containerStorage: "/repo/.local/containers/storage",
      containerRunRoot: "/repo/.temp/containers/run",
      containerTmp: "/repo/.temp/containers/tmp",
      containerfile: "/repo/scripts/dev/Containerfile",
      entrypoint: "/repo/scripts/dev/entrypoint.sh",
      nodeModules: "/repo/.local/dev/node_modules",
      devTemp: "/repo/.temp/dev",
      home: "/repo/.temp/dev/home",
      tmp: "/repo/.temp/tmp",
      bunCache: "/repo/.local/cache/bun",
    });
  });

  test("the host folders created before the container starts", () => {
    expect(hostFolders(paths)).toEqual([
      "/repo/.local/dev/node_modules",
      "/repo/.temp/dev",
      "/repo/.temp/tmp",
    ]);
  });
});

describe("dev container arguments", () => {
  const COMMON = [
    "run",
    "-d",
    "--name",
    "goop-dev",
    "--init",
    "--cap-drop=all",
    "--security-opt=no-new-privileges",
    "--tmpfs",
    "/tmp",
    "-v",
    "/repo:/repo",
    "-v",
    "/repo/.local/dev/node_modules:/repo/node_modules",
    "--workdir",
    "/repo",
    "--env",
    "GOOP_HOME=/repo/.temp/dev/home",
    "--env",
    "GOOP_RUNTIME_DIR=/tmp/goop-run",
    "--env",
    "BUN_INSTALL_CACHE_DIR=/repo/.local/cache/bun",
    "--env",
    "TMPDIR=/repo/.temp/tmp",
    "--env",
    "HOME=/tmp",
  ];
  const COMMAND = ["localhost/goop-dev:1", "bash", "/repo/scripts/dev/entrypoint.sh"];

  test("names the pinned image and container", () => {
    expect(IMAGE).toBe("localhost/goop-dev:1");
    expect(CONTAINER).toBe("goop-dev");
  });

  test("Podman starts it detached, the repo at the same path, with no --user", () => {
    expect(startArgs(paths)).toEqual([...COMMON, ...COMMAND]);
  });

  test("Docker runs it as the host user", () => {
    expect(startArgs(paths, "1000:1000")).toEqual([...COMMON, "--user", "1000:1000", ...COMMAND]);
  });

  test("inspect, remove and logs name the container", () => {
    expect(runningArgs()).toEqual([
      "container",
      "inspect",
      "--format",
      "{{.State.Running}}",
      "goop-dev",
    ]);
    expect(forceRemoveArgs()).toEqual(["rm", "--force", "goop-dev"]);
    expect(followLogsArgs()).toEqual(["logs", "--follow", "goop-dev"]);
  });

  test("the daemon is ready when its socket exists in the private runtime folder", () => {
    expect(socketCheckArgs()).toEqual([
      "exec",
      "goop-dev",
      "test",
      "-S",
      "/tmp/goop-run/goop.sock",
    ]);
  });

  test("isRunning reads inspect's answer", () => {
    expect(isRunning({ exitCode: 0, stdout: "true\n", stderr: "" })).toBe(true);
    expect(isRunning({ exitCode: 0, stdout: "false\n", stderr: "" })).toBe(false);
    expect(isRunning({ exitCode: 125, stdout: "", stderr: "no such container" })).toBe(false);
  });

  test("goop always gets -i, so piped input reaches it; -t only with a terminal", () => {
    const goop = ["bun", "--no-env-file", "src/main.ts", "--help", "two words"];
    expect(goopArgs(paths, ["--help", "two words"], true)).toEqual([
      "exec",
      "-it",
      "--workdir",
      "/repo",
      "goop-dev",
      ...goop,
    ]);
    expect(goopArgs(paths, ["--help", "two words"], false)).toEqual([
      "exec",
      "-i",
      "--workdir",
      "/repo",
      "goop-dev",
      ...goop,
    ]);
  });
});
