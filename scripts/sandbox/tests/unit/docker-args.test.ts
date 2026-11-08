import { expect, test } from "bun:test";
import { DEBIAN_IMAGE } from "../../model/debian-config";
import {
  buildArgs,
  copyInArgs,
  copyOutArgs,
  dockerEnvironment,
  execArgs,
  forceRemoveArgs,
  imageSizeArgs,
  installContainerArgs,
  listRunningArgs,
  manualRemoveCommand,
  systemdContainerArgs,
} from "../../model/docker-args";
import { sandboxPaths } from "../../model/paths";
import { describeOnLinuxHost } from "../linux-host";

const paths = sandboxPaths("/repo");

describeOnLinuxHost("docker arguments (S4)", () => {
  test("the environment carries only the password, when there is one", () => {
    expect(dockerEnvironment()).toEqual({});
    expect(dockerEnvironment("secret")).toEqual({ PASSWORD: "secret" });
  });

  test("builds the image from the Containerfile's own folder and reads its size", () => {
    expect(buildArgs(DEBIAN_IMAGE, paths.debianContainerfile)).toEqual([
      "build",
      "--tag",
      "localhost/goop-sandbox-debian:2",
      "--file",
      "/repo/scripts/sandbox/debian/Containerfile",
      "/repo/scripts/sandbox/debian",
    ]);
    expect(imageSizeArgs(DEBIAN_IMAGE)).toEqual([
      "image",
      "inspect",
      "--format",
      "{{.Size}}",
      "localhost/goop-sandbox-debian:2",
    ]);
  });

  test("starts systemd detached with the host cgroup tree writable and tmpfs on /run, /run/lock and /tmp", () => {
    expect(systemdContainerArgs("goop-debian-run-abc", DEBIAN_IMAGE)).toEqual([
      "run",
      "-d",
      "--name",
      "goop-debian-run-abc",
      "--cgroupns=host",
      "-v",
      "/sys/fs/cgroup:/sys/fs/cgroup:rw",
      "--tmpfs",
      "/run",
      "--tmpfs",
      "/run/lock",
      "--tmpfs",
      "/tmp:exec",
      "--env",
      "container=docker",
      "localhost/goop-sandbox-debian:2",
    ]);
  });

  test("exec, with and without a terminal", () => {
    expect(execArgs("c", ["systemctl", "is-system-running"])).toEqual([
      "exec",
      "c",
      "systemctl",
      "is-system-running",
    ]);
    expect(
      execArgs("c", ["bash", "-l"], {
        user: "goop",
        workdir: "/home/goop/goop",
        env: { XDG_RUNTIME_DIR: "/run/user/1000" },
        interactive: true,
      }),
    ).toEqual([
      "exec",
      "-it",
      "--user",
      "goop",
      "--workdir",
      "/home/goop/goop",
      "--env",
      "XDG_RUNTIME_DIR=/run/user/1000",
      "c",
      "bash",
      "-l",
    ]);
  });

  test("copies in and out, force-removes, and lists the running containers", () => {
    expect(copyInArgs("c", "/repo/src", "/home/goop/goop/")).toEqual([
      "cp",
      "/repo/src",
      "c:/home/goop/goop/",
    ]);
    expect(copyOutArgs("c", "/tmp/out.txt", "/repo/.temp/debian/results/x/")).toEqual([
      "cp",
      "c:/tmp/out.txt",
      "/repo/.temp/debian/results/x/",
    ]);
    expect(forceRemoveArgs("c")).toEqual(["rm", "--force", "c"]);
    expect(manualRemoveCommand("c")).toBe("docker rm -f c");
    expect(listRunningArgs("goop-debian")).toEqual([
      "ps",
      "--filter",
      "name=goop-debian",
      "--format",
      "{{.Names}}\t{{.Status}}",
    ]);
  });

  test("Windows uses the same dockur arguments as Podman: devices, NET_ADMIN, env and mounts", () => {
    const install = installContainerArgs(paths);
    expect(install.slice(0, 10)).toEqual([
      "run",
      "-d",
      "--name",
      "goop-windows-install",
      "--device",
      "/dev/kvm",
      "--device",
      "/dev/net/tun",
      "--cap-add",
      "NET_ADMIN",
    ]);
    expect(install.slice(-5)).toEqual([
      "-v",
      "/repo/.local/windows/base:/storage",
      "-v",
      "/repo/.local/windows/oem:/oem",
      "docker.io/dockurr/windows:6.06",
    ]);
  });
});
