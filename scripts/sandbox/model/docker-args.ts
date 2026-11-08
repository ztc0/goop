// Docker arguments (S4). Docker takes the same subcommands and flags as Podman for the dockur
// Windows containers, so those builders are shared; only what Docker does differently lives
// here. The builders every container takes in the same form and the engine environment live
// in scripts/shared/containers. The Windows arguments are built but never run on Docker: this
// PC has no Docker, and a 25-minute Windows install is too heavy for CI.
export {
  installContainerArgs,
  overlayArgs,
  runContainerArgs,
  stopArgs,
} from "@scripts/sandbox/model/podman-args";

/**
 * A container whose process 1 is systemd. Docker has no `--systemd=always`, and on a cgroup v2
 * host it mounts the container's own cgroup tree read-only unless `--privileged`, so systemd
 * cannot create init.scope. The least privilege that works without `--privileged`: the host
 * cgroup namespace with the cgroup tree mounted writable, tmpfs on /run, /run/lock and /tmp
 * (systemd cannot mount them itself without CAP_SYS_ADMIN; /tmp keeps exec as under Podman),
 * and `container=docker` so systemd knows it runs in a container. Sources: moby/moby#42275
 * ("Unable to run systemd in docker with ro /sys/fs/cgroup"), the jrei/systemd images README,
 * and systemd.io/CONTAINER_INTERFACE. The container can write the host's cgroup tree, which is
 * acceptable for a throwaway container on a CI runner; Podman, the default, needs none of this.
 */
export function systemdContainerArgs(name: string, image: string): string[] {
  return [
    "run",
    "-d",
    "--name",
    name,
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
    image,
  ];
}

/** Docker's `rm` has no `--time`: `--force` kills the container and deletes it. */
export function forceRemoveArgs(name: string): string[] {
  return ["rm", "--force", name];
}

/** The command a user runs to remove a container the sandbox could not. */
export function manualRemoveCommand(name: string): string {
  return `docker rm -f ${name}`;
}
