import { expect, test } from "bun:test";
import {
  DEBIAN_IMAGE,
  debianContainerName,
  debianResultsDirectory,
  isSystemdUp,
  SYSTEMD_READY_CHECK,
  userCommand,
  userShell,
} from "../../model/debian-config";
import { sandboxPaths } from "../../model/paths";
import {
  buildArgs,
  copyInArgs,
  copyOutArgs,
  execArgs,
  forceRemoveArgs,
  imageSizeArgs,
  listRunningArgs,
  manualRemoveCommand,
  systemdContainerArgs,
} from "../../model/podman-args";
import { describeOnLinuxHost } from "../linux-host";

const paths = sandboxPaths("/repo");

describeOnLinuxHost("Debian sandbox (S2)", () => {
  test("keeps the Containerfile in the scripts and the results in .temp/debian/ (S7)", () => {
    expect(paths.debianContainerfile).toBe("/repo/scripts/sandbox/debian/Containerfile");
    expect(debianResultsDirectory(paths, "20261101-090503-a1b2")).toBe(
      "/repo/.temp/debian/results/20261101-090503-a1b2",
    );
  });

  test("names the image and each run's container", () => {
    expect(DEBIAN_IMAGE).toBe("localhost/goop-sandbox-debian:1");
    expect(debianContainerName("abc")).toBe("goop-debian-run-abc");
  });

  test("builds the image from the Containerfile's own folder", () => {
    expect(buildArgs(DEBIAN_IMAGE, paths.debianContainerfile)).toEqual([
      "build",
      "--tag",
      "localhost/goop-sandbox-debian:1",
      "--file",
      "/repo/scripts/sandbox/debian/Containerfile",
      "/repo/scripts/sandbox/debian",
    ]);
    expect(imageSizeArgs(DEBIAN_IMAGE)).toEqual([
      "image",
      "inspect",
      "--format",
      "{{.Size}}",
      "localhost/goop-sandbox-debian:1",
    ]);
  });

  test("starts the container detached with systemd as process 1", () => {
    expect(systemdContainerArgs("goop-debian-run-abc", DEBIAN_IMAGE)).toEqual([
      "run",
      "-d",
      "--name",
      "goop-debian-run-abc",
      "--systemd=always",
      "localhost/goop-sandbox-debian:1",
    ]);
  });

  test("exec, copy in and out, force remove and the running list", () => {
    expect(execArgs("c", ["id"])).toEqual(["exec", "c", "id"]);
    expect(
      execArgs("c", ["bash", "-lc", "id"], {
        user: "goop",
        workdir: "/home/goop",
        env: { A: "1", B: "2" },
      }),
    ).toEqual([
      "exec",
      "--user",
      "goop",
      "--workdir",
      "/home/goop",
      "--env",
      "A=1",
      "--env",
      "B=2",
      "c",
      "bash",
      "-lc",
      "id",
    ]);
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
    expect(forceRemoveArgs("c")).toEqual(["rm", "--force", "--time", "10", "c"]);
    expect(manualRemoveCommand(paths, "c")).toBe(
      "bun scripts/dev-env/run.ts podman --root /repo/.local/containers/storage --runroot /repo/.temp/containers/run rm -f c",
    );
    expect(listRunningArgs("goop-debian")).toEqual([
      "ps",
      "--filter",
      "name=goop-debian",
      "--format",
      "{{.Names}}\t{{.Status}}",
    ]);
  });

  test("runs the command as goop with bash -lc and the user manager's runtime dir", () => {
    expect(userCommand("systemctl --user status; exit 3")).toEqual({
      command: ["bash", "-lc", "systemctl --user status; exit 3"],
      options: {
        user: "goop",
        workdir: "/home/goop/goop",
        env: {
          XDG_RUNTIME_DIR: "/run/user/1000",
          DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
        },
        stream: true,
      },
    });
  });

  test("an interactive exec attaches a terminal with -it", () => {
    expect(execArgs("c", ["bash", "-l"], { user: "goop", interactive: true })).toEqual([
      "exec",
      "-it",
      "--user",
      "goop",
      "c",
      "bash",
      "-l",
    ]);
  });

  test("the shell is a bash login shell as goop, with the same folder and runtime dir as a command", () => {
    expect(userShell()).toEqual({
      command: ["bash", "-l"],
      options: {
        user: "goop",
        workdir: "/home/goop/goop",
        env: {
          XDG_RUNTIME_DIR: "/run/user/1000",
          DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
        },
        interactive: true,
      },
    });
  });

  test("waits for the boot with a bounded systemctl is-system-running --wait", () => {
    expect(SYSTEMD_READY_CHECK).toEqual([
      "timeout",
      "30",
      "systemctl",
      "is-system-running",
      "--wait",
    ]);
  });

  test("systemd is up when it reports running or degraded, not while it boots", () => {
    expect(isSystemdUp("running\n")).toBe(true);
    expect(isSystemdUp("degraded\n")).toBe(true);
    for (const state of ["", "starting\n", "initializing\n", "offline\n", "maintenance\n"]) {
      expect(isSystemdUp(state)).toBe(false);
    }
    expect(isSystemdUp("Failed to connect to bus: No such file or directory\n")).toBe(false);
  });
});
