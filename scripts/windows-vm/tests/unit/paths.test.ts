import { describe, expect, test } from "bun:test";
import { displayPath, resultsDirectory, runDirectory, windowsVmPaths } from "../../model/paths";

describe("windowsVmPaths", () => {
  test("keeps Podman, the Windows base and the runs inside the repo (S3)", () => {
    expect(windowsVmPaths("/repo")).toEqual({
      root: "/repo",
      containerStorage: "/repo/.local/containers/storage",
      containerRunRoot: "/repo/.temp/containers/run",
      containerTmp: "/repo/.temp/containers/tmp",
      windows: "/repo/.local/windows",
      base: "/repo/.local/windows/base",
      baseDisk: "/repo/.local/windows/base/data.qcow2",
      oem: "/repo/.local/windows/oem",
      ssh: "/repo/.local/windows/ssh",
      sshKey: "/repo/.local/windows/ssh/id_ed25519",
      sshPublicKey: "/repo/.local/windows/ssh/id_ed25519.pub",
      password: "/repo/.local/windows/password",
      temp: "/repo/.temp/windows",
      knownHosts: "/repo/.temp/windows/known_hosts",
      runs: "/repo/.temp/windows/runs",
      results: "/repo/.temp/windows/results",
    });
  });

  test("gives each run its own throwaway storage and results folder", () => {
    const paths = windowsVmPaths("/repo");

    expect(runDirectory(paths, "20261101-090503-a1b2")).toBe(
      "/repo/.temp/windows/runs/20261101-090503-a1b2",
    );
    expect(resultsDirectory(paths, "20261101-090503-a1b2")).toBe(
      "/repo/.temp/windows/results/20261101-090503-a1b2",
    );
  });

  test("shows folders relative to the repo root with a trailing slash", () => {
    const paths = windowsVmPaths("/repo");

    expect(displayPath(paths, paths.base)).toBe(".local/windows/base/");
    expect(displayPath(paths, resultsDirectory(paths, "x"))).toBe(".temp/windows/results/x/");
  });
});
