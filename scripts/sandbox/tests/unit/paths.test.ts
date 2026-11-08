import { describe, expect, test } from "bun:test";
import { displayPath, resultsDirectory, runDirectory, sandboxPaths } from "../../model/paths";
import { describeOnLinuxHost } from "../linux-host";

describeOnLinuxHost("sandboxPaths", () => {
  test("keeps Podman, the Windows base and the runs inside the repo (S3)", () => {
    expect(sandboxPaths("/repo")).toEqual({
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
      debianContainerfile: "/repo/scripts/sandbox/debian/Containerfile",
      debianResults: "/repo/.temp/debian/results",
      bunCache: "/repo/.local/cache/sandbox-bun",
      downloads: "/repo/.temp/downloads",
      suite: "/repo/.temp/sandbox-test",
    });
  });

  test("gives each run its own throwaway storage and results folder", () => {
    const paths = sandboxPaths("/repo");

    expect(runDirectory(paths, "20261101-090503-a1b2")).toBe(
      "/repo/.temp/windows/runs/20261101-090503-a1b2",
    );
    expect(resultsDirectory(paths, "20261101-090503-a1b2")).toBe(
      "/repo/.temp/windows/results/20261101-090503-a1b2",
    );
  });

  test("shows folders relative to the repo root with a trailing slash", () => {
    const paths = sandboxPaths("/repo");

    expect(displayPath(paths, paths.base)).toBe(".local/windows/base/");
    expect(displayPath(paths, resultsDirectory(paths, "x"))).toBe(".temp/windows/results/x/");
  });

  test("uses forward slashes even when the system separator is a backslash, as on Windows", () => {
    const paths = sandboxPaths("/repo");

    expect(displayPath(paths, "/repo/.temp\\debian\\results\\r3")).toBe(".temp/debian/results/r3/");
  });
});
