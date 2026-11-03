import { describe, expect, test } from "bun:test";
import { sandboxPaths } from "../../model/paths";
import {
  installContainerArgs,
  listRunningArgs,
  logsArgs,
  overlayArgs,
  podmanEnvironment,
  podmanGlobalArgs,
  removeArgs,
  runContainerArgs,
  stopArgs,
} from "../../model/podman-args";
import { WINDOWS_IMAGE } from "../../model/vm-config";
import { describeOnLinuxHost } from "../linux-host";

const paths = sandboxPaths("/repo");

const VM_OPTIONS = [
  "--device",
  "/dev/kvm",
  "--device",
  "/dev/net/tun",
  "--cap-add",
  "NET_ADMIN",
  "--stop-timeout",
  "120",
  "-e",
  "VERSION=11l",
  "-e",
  "DISK_FMT=qcow2",
  "-e",
  "RAM_SIZE=8G",
  "-e",
  "CPU_CORES=4",
  "-e",
  "DISK_SIZE=64G",
  "-e",
  "USERNAME=goop",
  "-e",
  "PASSWORD",
  "-e",
  "USER_PORTS=22",
  "-e",
  "LOG=Y",
  "-p",
  "127.0.0.1:2222:22",
  "-p",
  "127.0.0.1:8006:8006",
];

describeOnLinuxHost("podman arguments", () => {
  test("pins the dockur image", () => {
    expect(WINDOWS_IMAGE).toBe("docker.io/dockurr/windows:6.06");
  });

  test("points the graph root, runroot and tmpdir inside the repo (S3)", () => {
    expect(podmanGlobalArgs(paths)).toEqual([
      "--root",
      "/repo/.local/containers/storage",
      "--runroot",
      "/repo/.temp/containers/run",
      "--tmpdir",
      "/repo/.temp/containers/tmp",
    ]);
    expect(podmanEnvironment(paths)).toEqual({ TMPDIR: "/repo/.temp/containers/tmp" });
    expect(podmanEnvironment(paths, "secret")).toEqual({
      TMPDIR: "/repo/.temp/containers/tmp",
      PASSWORD: "secret",
    });
  });

  test("install keeps its container, mounts the base as /storage and the OEM folder", () => {
    expect(installContainerArgs(paths)).toEqual([
      "run",
      "-d",
      "--name",
      "goop-windows-install",
      ...VM_OPTIONS,
      "-v",
      "/repo/.local/windows/base:/storage",
      "-v",
      "/repo/.local/windows/oem:/oem",
      "docker.io/dockurr/windows:6.06",
    ]);
  });

  test("a run uses --rm, the throwaway storage and the base read-only (S5)", () => {
    expect(runContainerArgs(paths, "abc")).toEqual([
      "run",
      "-d",
      "--rm",
      "--name",
      "goop-windows-run-abc",
      ...VM_OPTIONS,
      "-v",
      "/repo/.temp/windows/runs/abc:/storage",
      "-v",
      "/repo/.local/windows/base:/base:ro",
      "docker.io/dockurr/windows:6.06",
    ]);
  });

  test("the overlay is created by qemu-img inside the same image, backed by /base", () => {
    expect(overlayArgs(paths, "abc")).toEqual([
      "run",
      "--rm",
      "--entrypoint",
      "qemu-img",
      "-v",
      "/repo/.local/windows/base:/base:ro",
      "-v",
      "/repo/.temp/windows/runs/abc:/storage",
      "docker.io/dockurr/windows:6.06",
      "create",
      "-f",
      "qcow2",
      "-F",
      "qcow2",
      "-b",
      "/base/data.qcow2",
      "/storage/data.qcow2",
    ]);
  });

  test("stop, remove, logs and the running list", () => {
    expect(stopArgs("goop-windows-install")).toEqual(["stop", "-t", "120", "goop-windows-install"]);
    expect(removeArgs("goop-windows-install")).toEqual(["rm", "goop-windows-install"]);
    expect(logsArgs("goop-windows-install")).toEqual([
      "logs",
      "--tail",
      "50",
      "goop-windows-install",
    ]);
    expect(listRunningArgs()).toEqual([
      "ps",
      "--filter",
      "name=goop-windows",
      "--format",
      "{{.Names}}\t{{.Status}}",
    ]);
  });
});
