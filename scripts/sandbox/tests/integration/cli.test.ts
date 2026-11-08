import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { describeOnLinuxHost } from "../linux-host";

const repo = resolve(import.meta.dir, "..", "..", "..", "..");
const cliScript = join(repo, "scripts", "sandbox", "cli.ts");
const IMAGE = "docker.io/dockurr/windows:6.06";
const FAKE_PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTests";

const USAGE = `Usage: bun scripts/sandbox/cli.ts <command> <system> [options]

Commands:
  install <system>  Install Windows once into .local/windows/base/ (about 25 min),
                    or build the Debian image (a few minutes; again to rebuild)
  run <system> [--copy <repo path>]... [--fetch <sandbox path>]... [--] [<command...>]
                    Run a PowerShell command (windows) or a shell command (debian)
                    in a throwaway sandbox; it and its changes are deleted at the end;
                    debian without a command opens a shell in it until you type exit
  status <system>   Show the Windows base or the Debian image, and running sandboxes

Systems:
  windows           A Windows 11 VM
  debian            A Debian 13 container with systemd

Options:
  --engine <engine> podman or docker; by default Podman if installed, else Docker

Examples:
  bun run sandbox:install debian
  bun run sandbox:run debian           # opens a shell; exit deletes the container
  bun run sandbox:run debian uname -a
  bun run sandbox:run windows --copy dist 'Get-ChildItem C:\\goop'
  bun run sandbox:status windows
`;

const LOG_ARGS = `{ printf '%s' "$(basename "$0")"; for arg in "$@"; do printf '\\037%s' "$arg"; done; printf '\\n'; } >> "$FAKE_LOG"`;

// Fake host tools: they log their argv (separated by \x1f, since podman's --format holds a
// tab) and reply with scripted output.
const FAKES: Record<string, string> = {
  podman: `#!/bin/sh
${LOG_ARGS}
printf '%s\\t%s\\n' "$TMPDIR" "$PASSWORD" >> "$FAKE_LOG.env"
storage=""
for arg in "$@"; do
  case "$arg" in
    *:/storage) storage="\${arg%:/storage}" ;;
  esac
done
case " $* " in
  *" --entrypoint qemu-img "*) printf 'overlay' > "$storage/data.qcow2" ;;
  *" run -d --rm "*) ls "$storage" >> "$FAKE_LOG.storage" ;;
  *" ps "*) if [ -z "$FAKE_PS_EMPTY" ]; then printf '%s\\tUp 2 minutes\\n' "\${FAKE_PS_NAME:-goop-windows-run-test}"; fi ;;
  *" logs "*) printf 'fake container log\\n' ;;
  *" build "*) printf 'STEP 1/4: FROM debian\\n'; exit "\${FAKE_BUILD_EXIT:-0}" ;;
  *" image inspect "*) if [ -n "$FAKE_NO_IMAGE" ]; then printf 'Error: no such image\\n' >&2; exit 125; fi; printf '123456789\\n' ;;
  *" is-system-running "*) printf 'running\\n' ;;
  *" bash -lc "*) printf 'container output\\n'; exit "\${FAKE_EXEC_EXIT:-0}" ;;
  *" rm --force "*) if [ -n "$FAKE_RM_FAIL" ]; then printf 'Error: container is stuck\\n' >&2; exit 125; fi ;;
esac
exit 0
`,
  ssh: `#!/bin/sh
${LOG_ARGS}
case "$*" in
  *"-Command -; exit "*) cat >> "$FAKE_LOG.stdin"; printf 'guest output\\n'; exit "\${FAKE_SSH_EXIT:-0}" ;;
  *"Test-Path"*) printf 'True\\n' ;;
  *"echo ok") printf 'ok\\n' ;;
esac
exit 0
`,
  scp: `#!/bin/sh
${LOG_ARGS}
exit 0
`,
  "ssh-keygen": `#!/bin/sh
${LOG_ARGS}
key=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-f" ]; then key="$2"; fi
  shift
done
printf 'fake private key\\n' > "$key"
chmod 600 "$key"
printf '%s goop-windows-vm\\n' "${FAKE_PUBLIC_KEY}" > "$key.pub"
`,
};

let fixture: string;
let root: string;
let log: string;

beforeEach(() => {
  fixture = join(repo, ".temp", "tests", `sandbox-cli-${crypto.randomUUID()}`);
  root = join(fixture, "repo");
  log = join(fixture, "calls.log");
  const bin = join(fixture, "bin");
  mkdirSync(root, { recursive: true });
  mkdirSync(bin, { recursive: true });
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function cli(args: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync([process.execPath, cliScript, ...args], {
    env: {
      ...process.env,
      GOOP_REPO_ROOT: root,
      PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
      FAKE_LOG: log,
      PASSWORD: "",
      ...env,
    },
    stdin: "ignore",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/**
 * A PATH holding only the named fakes (and the tools the fakes call), so the real
 * podman or docker on the host cannot be found (S3).
 */
function isolatedPath(fakes: Record<string, string>): string {
  const bin = join(fixture, "isolated-bin");
  mkdirSync(bin, { recursive: true });
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  for (const tool of ["basename", "ls"]) {
    const real = Bun.which(tool);
    if (real !== null) symlinkSync(real, join(bin, tool));
  }
  return bin;
}

/** Docker takes the same subcommands as Podman, so the same fake answers both. */
const FAKE_DOCKER = FAKES.podman ?? "";

function readLines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
}

function calls(): string[][] {
  return readLines(log).map((line) => line.split("\x1f"));
}

function globals(): string[] {
  return [
    "--root",
    join(root, ".local", "containers", "storage"),
    "--runroot",
    join(root, ".temp", "containers", "run"),
    "--tmpdir",
    join(root, ".temp", "containers", "tmp"),
  ];
}

/** Podman subcommands, after checking that every call carries the repo-local globals (S3). */
function podmanCalls(): string[][] {
  const podman = calls().filter((call) => call[0] === "podman");
  for (const call of podman) {
    expect(call.slice(1, 7)).toEqual(globals());
  }
  return podman.map((call) => call.slice(7));
}

/** Docker subcommands: Docker uses its own storage, so no call carries the Podman globals (S3). */
function dockerCalls(): string[][] {
  const docker = calls().filter((call) => call[0] === "docker");
  for (const call of docker) {
    expect(call).not.toContain("--root");
  }
  return docker.map((call) => call.slice(1));
}

const DOCKER_WARNING =
  "Using Docker: its images and containers live in Docker's own storage (usually /var/lib/docker), outside this repository.";

function sshOptions(): string[] {
  return [
    "-i",
    join(root, ".local", "windows", "ssh", "id_ed25519"),
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    `UserKnownHostsFile=${join(root, ".temp", "windows", "known_hosts")}`,
    "-o",
    "ConnectTimeout=6",
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "LogLevel=ERROR",
  ];
}

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

const BASE_FILES: Record<string, string> = {
  "data.qcow2": "base-disk",
  "windows.vars": "uefi-vars",
  "windows.rom": "rom",
  "win11x64.iso": "iso",
};

function seedBase(): string {
  const base = join(root, ".local", "windows", "base");
  mkdirSync(base, { recursive: true });
  for (const [name, content] of Object.entries(BASE_FILES)) {
    writeFileSync(join(base, name), content);
  }
  const ssh = join(root, ".local", "windows", "ssh");
  mkdirSync(ssh, { recursive: true });
  writeFileSync(join(ssh, "id_ed25519"), "fake private key\n");
  writeFileSync(join(ssh, "id_ed25519.pub"), `${FAKE_PUBLIC_KEY} goop-windows-vm\n`);
  writeFileSync(join(root, ".local", "windows", "password"), "0123456789abcdef");
  return base;
}

function expectBaseUnchanged(base: string): void {
  expect(readdirSync(base).sort()).toEqual(Object.keys(BASE_FILES).sort());
  for (const [name, content] of Object.entries(BASE_FILES)) {
    expect(readFileSync(join(base, name), "utf8")).toBe(content);
  }
}

describeOnLinuxHost("scripts/sandbox/cli.ts usage", () => {
  test("without a command it prints the usage to stderr and exits 2", () => {
    const result = cli([]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(USAGE);
    expect(calls()).toEqual([]);
  });

  test("an unknown command prints the usage to stderr and exits 2", () => {
    const result = cli(["start"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(USAGE);
  });

  test("a bad run option prints the error and the usage, and exits 2", () => {
    const result = cli(["run", "windows", "--copy"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`--copy needs a value.\n${USAGE}`);
    expect(calls()).toEqual([]);
  });

  test("a missing system prints the error and the usage, and exits 2 (S1)", () => {
    for (const command of ["install", "status", "run"]) {
      const result = cli([command]);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`${command} needs the system first: windows or debian.\n${USAGE}`);
    }
    expect(calls()).toEqual([]);
  });

  test("an unknown system prints the error and the usage, and exits 2 (S1)", () => {
    const result = cli(["install", "macos"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`Unknown system: macos (expected windows or debian).\n${USAGE}`);
    expect(calls()).toEqual([]);
  });

  test("--os prints how to write the system instead, and exits 2 (S1)", () => {
    for (const args of [
      ["run", "--os", "debian", "uname", "-a"],
      ["status", "debian", "--os", "debian"],
    ]) {
      const result = cli(args);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        `--os was replaced: write the system right after the command, like: bun run sandbox:run debian uname -a\n${USAGE}`,
      );
    }
    expect(calls()).toEqual([]);
  });

  test("install and status with a command point to run, and exit 2 (S1)", () => {
    for (const command of ["install", "status"]) {
      const result = cli([command, "debian", "systemctl --version"]);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        `${command} takes no command; to run one, use: bun run sandbox:run <system> <command>\n${USAGE}`,
      );
    }
    expect(calls()).toEqual([]);
  });

  test("run debian without a command and without a terminal asks for a command, and exits 2 (S2)", () => {
    for (const args of [
      ["run", "debian"],
      ["run", "debian", "--"],
    ]) {
      const result = cli(args);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "run debian without a command opens a shell and needs a terminal; pass a command instead, like: bun run sandbox:run debian uname -a\n",
      );
    }
    expect(calls()).toEqual([]);
    expect(readdirSync(root)).toEqual([]);
  });

  test("run windows without a command still asks for a PowerShell command, and exits 2", () => {
    const result = cli(["run", "windows"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`run needs a PowerShell command.\n${USAGE}`);
    expect(calls()).toEqual([]);
  });
});

describeOnLinuxHost("scripts/sandbox/cli.ts run", () => {
  test("without a base it exits 1 with the install hint and creates nothing", () => {
    const result = cli(["run", "windows", "--", "Get-Date"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("No Windows base: run `bun run sandbox:install windows` first.\n");
    expect(readdirSync(root)).toEqual([]);
    expect(calls()).toEqual([]);
  });

  test("runs on a throwaway overlay, stops the VM and deletes the run dir even when the command fails (S5)", () => {
    const base = seedBase();

    const result = cli(["run", "windows", "--", "Write-Output", "hi;", "exit", "3"], {
      FAKE_SSH_EXIT: "3",
    });

    const podman = podmanCalls();
    const name = podman[1]?.[4] ?? "";
    expect(name).toMatch(/^goop-windows-run-\d{8}-\d{6}-[0-9a-f]{4}$/);
    const id = name.replace("goop-windows-run-", "");
    const runDir = join(root, ".temp", "windows", "runs", id);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        "Creating a throwaway disk over the Windows base...",
        `Starting ${name}...`,
        "Waiting for SSH on 127.0.0.1:2222 (watch at http://127.0.0.1:8006)...",
        "Windows is ready.",
        "guest output",
        `Stopping ${name}...`,
        "",
      ].join("\n"),
    );
    expect(podman).toEqual([
      [
        "run",
        "--rm",
        "--entrypoint",
        "qemu-img",
        "-v",
        `${base}:/base:ro`,
        "-v",
        `${runDir}:/storage`,
        IMAGE,
        "create",
        "-f",
        "qcow2",
        "-F",
        "qcow2",
        "-b",
        "/base/data.qcow2",
        "/storage/data.qcow2",
      ],
      [
        "run",
        "-d",
        "--rm",
        "--name",
        name,
        ...VM_OPTIONS,
        "-v",
        `${runDir}:/storage`,
        "-v",
        `${base}:/base:ro`,
        IMAGE,
      ],
      ["stop", "-t", "120", name],
    ]);
    expect(readLines(`${log}.storage`)).toEqual(["data.qcow2", "windows.rom", "windows.vars"]);
    const tmp = join(root, ".temp", "containers", "tmp");
    // Only the VM start receives the password, through the environment and never in argv.
    expect(readLines(`${log}.env`)).toEqual([`${tmp}\t`, `${tmp}\t0123456789abcdef`, `${tmp}\t`]);
    expect(readFileSync(`${log}.stdin`, "utf8")).toBe("Write-Output hi; exit 3\r\n");
    expect(calls().filter((call) => call[0] === "ssh")).toEqual([
      ["ssh", ...sshOptions(), "-p", "2222", "goop@127.0.0.1", "echo ok"],
      [
        "ssh",
        ...sshOptions(),
        "-p",
        "2222",
        "goop@127.0.0.1",
        "powershell -NoProfile -Command -; exit $LASTEXITCODE",
      ],
    ]);
    expect(readdirSync(join(root, ".temp", "windows", "runs"))).toEqual([]);
    expectBaseUnchanged(base);
  });

  test("uploads --copy paths to C:\\goop\\ and fetches --fetch paths into .temp/windows/results/", () => {
    const base = seedBase();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.ts"), "export {};\n");

    const result = cli([
      "run",
      "windows",
      "--copy",
      "src",
      "--fetch",
      "C:\\goop\\out.xml",
      "--",
      "bun",
      "test",
    ]);

    const name = podmanCalls()[1]?.[4] ?? "";
    const id = name.replace("goop-windows-run-", "");
    const results = join(root, ".temp", "windows", "results", id);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        "Creating a throwaway disk over the Windows base...",
        `Starting ${name}...`,
        "Waiting for SSH on 127.0.0.1:2222 (watch at http://127.0.0.1:8006)...",
        "Windows is ready.",
        "Uploading src to C:\\goop\\...",
        "guest output",
        `Fetched C:\\goop\\out.xml into .temp/windows/results/${id}/`,
        `Stopping ${name}...`,
        "",
      ].join("\n"),
    );
    expect(calls().filter((call) => call[0] !== "podman")).toEqual([
      ["ssh", ...sshOptions(), "-p", "2222", "goop@127.0.0.1", "echo ok"],
      [
        "ssh",
        ...sshOptions(),
        "-p",
        "2222",
        "goop@127.0.0.1",
        "New-Item -ItemType Directory -Force -Path C:\\goop | Out-Null",
      ],
      ["scp", ...sshOptions(), "-P", "2222", "-r", join(root, "src"), "goop@127.0.0.1:C:/goop/"],
      [
        "ssh",
        ...sshOptions(),
        "-p",
        "2222",
        "goop@127.0.0.1",
        "powershell -NoProfile -Command -; exit $LASTEXITCODE",
      ],
      ["scp", ...sshOptions(), "-P", "2222", "-r", "goop@127.0.0.1:C:/goop/out.xml", `${results}/`],
    ]);
    expect(existsSync(results)).toBe(true);
    expect(readdirSync(join(root, ".temp", "windows", "runs"))).toEqual([]);
    expectBaseUnchanged(base);
  });

  test("refuses to upload a path outside the repo before starting anything", () => {
    seedBase();

    const result = cli(["run", "windows", "--copy", "../outside", "--", "Get-Date"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Cannot copy ../outside: only existing paths inside the repo can be uploaded.\n",
    );
    expect(calls()).toEqual([]);
    expect(existsSync(join(root, ".temp"))).toBe(false);
  });
});

describeOnLinuxHost("scripts/sandbox/cli.ts install", () => {
  test("refuses when a base already exists and never calls podman", () => {
    const base = seedBase();

    const result = cli(["install", "windows"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "A Windows base already exists in .local/windows/base/. Delete that folder to install again.\n",
    );
    expect(calls()).toEqual([]);
    expectBaseUnchanged(base);
  });

  test("generates the key, password and OEM files, waits for the marker, then stops and removes the container", () => {
    const result = cli(["install", "windows"]);

    const windows = join(root, ".local", "windows");
    const password = readFileSync(join(windows, "password"), "utf8");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        "Generating the SSH key for the VM...",
        "Starting goop-windows-install (the first install takes about 25 minutes)...",
        "Watch the installation at http://127.0.0.1:8006",
        "Waiting for SSH and C:\\OEM\\ready.txt (up to 60m 0s)...",
        "Windows is ready.",
        "Stopping goop-windows-install...",
        "Windows base installed in .local/windows/base/",
        "",
      ].join("\n"),
    );
    expect(password).toMatch(/^[0-9a-f]{32}$/);
    expect(statSync(join(windows, "password")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(windows, "oem", "install.bat"), "utf8")).toContain(
      "powershell -ExecutionPolicy Bypass -File C:\\OEM\\setup.ps1",
    );
    expect(readFileSync(join(windows, "oem", "setup.ps1"), "utf8")).toContain(
      `-Value '${FAKE_PUBLIC_KEY}'`,
    );
    expect(podmanCalls()).toEqual([
      [
        "run",
        "-d",
        "--name",
        "goop-windows-install",
        ...VM_OPTIONS,
        "-v",
        `${join(windows, "base")}:/storage`,
        "-v",
        `${join(windows, "oem")}:/oem`,
        IMAGE,
      ],
      ["stop", "-t", "120", "goop-windows-install"],
      ["rm", "goop-windows-install"],
    ]);
    expect(readLines(`${log}.env`)[0]).toBe(
      `${join(root, ".temp", "containers", "tmp")}\t${password}`,
    );
    expect(calls().filter((call) => call[0] !== "podman")).toEqual([
      [
        "ssh-keygen",
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-C",
        "goop-windows-vm",
        "-f",
        join(windows, "ssh", "id_ed25519"),
      ],
      ["ssh", ...sshOptions(), "-p", "2222", "goop@127.0.0.1", "echo ok"],
      ["ssh", ...sshOptions(), "-p", "2222", "goop@127.0.0.1", "Test-Path C:\\OEM\\ready.txt"],
    ]);
  });
});

describeOnLinuxHost("scripts/sandbox/cli.ts status", () => {
  test("without a base it says so and lists the running VMs", () => {
    const result = cli(["status", "windows"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "Windows base: none (run `bun run sandbox:install windows`)\nRunning VMs:\n  goop-windows-run-test\tUp 2 minutes\n",
    );
    expect(podmanCalls()).toEqual([
      ["ps", "--filter", "name=goop-windows", "--format", "{{.Names}}\t{{.Status}}"],
    ]);
  });

  test("with a base it prints its size, and none when no VM runs", () => {
    seedBase();

    const result = cli(["status", "windows"], { FAKE_PS_EMPTY: "1" });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("Windows base: .local/windows/base/ (24 B)\nRunning VMs: none\n");
  });
});

describeOnLinuxHost("scripts/sandbox/cli.ts --engine (S3)", () => {
  test("without --engine and only Podman installed it behaves as before, with no warning", () => {
    const result = cli(["status", "windows"], {
      PATH: isolatedPath({ podman: FAKES.podman ?? "" }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "Windows base: none (run `bun run sandbox:install windows`)\nRunning VMs:\n  goop-windows-run-test\tUp 2 minutes\n",
    );
    expect(podmanCalls()).toEqual([
      ["ps", "--filter", "name=goop-windows", "--format", "{{.Names}}\t{{.Status}}"],
    ]);
  });

  test("--engine docker runs status with Docker after the storage warning", () => {
    const result = cli(["status", "windows", "--engine", "docker"], {
      PATH: isolatedPath({ docker: FAKE_DOCKER }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(`${DOCKER_WARNING}\n`);
    expect(result.stdout).toBe(
      "Windows base: none (run `bun run sandbox:install windows`)\nRunning VMs:\n  goop-windows-run-test\tUp 2 minutes\n",
    );
    expect(dockerCalls()).toEqual([
      ["ps", "--filter", "name=goop-windows", "--format", "{{.Names}}\t{{.Status}}"],
    ]);
  });

  test("with neither Podman nor Docker on PATH it names what to install and exits 1", () => {
    const PATH = isolatedPath({});
    for (const args of [["install"], ["status"], ["run", "--", "Get-Date"]]) {
      const [command, ...rest] = args;
      const result = cli([command ?? "", "windows", ...rest], { PATH });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "No container engine found. Install Podman (recommended) or Docker.\n",
      );
    }
    expect(calls()).toEqual([]);
    expect(readdirSync(root)).toEqual([]);
  });

  test("an unknown --engine prints the error and the usage, and exits 2", () => {
    const result = cli(["status", "windows", "--engine", "lxc"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`Unknown --engine: lxc (expected podman or docker).\n${USAGE}`);
    expect(calls()).toEqual([]);
  });
});

const DEBIAN_IMAGE = "localhost/goop-sandbox-debian:2";
const USER_EXEC = [
  "exec",
  "--user",
  "goop",
  "--workdir",
  "/home/goop/goop",
  "--env",
  "XDG_RUNTIME_DIR=/run/user/1000",
  "--env",
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
];

/** The run's container name, from the engine's `run` call, and its run id. */
function debianRun(engineCalls: string[][]): { name: string; id: string } {
  const name = engineCalls.find((call) => call[0] === "run")?.[3] ?? "";
  expect(name).toMatch(/^goop-debian-run-\d{8}-\d{6}-[0-9a-f]{4}$/);
  return { name, id: name.replace("goop-debian-run-", "") };
}

describeOnLinuxHost("scripts/sandbox/cli.ts debian (S2)", () => {
  test("install builds the image from the Containerfile, again on every install", () => {
    const containerfile = join(root, "scripts", "sandbox", "debian", "Containerfile");
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = cli(["install", "debian"]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(
        [
          `Building ${DEBIAN_IMAGE} from scripts/sandbox/debian/Containerfile...`,
          "STEP 1/4: FROM debian",
          `Debian image ${DEBIAN_IMAGE} is ready (0m 0s).`,
          "",
        ].join("\n"),
      );
      const build = [
        "build",
        "--tag",
        DEBIAN_IMAGE,
        "--file",
        containerfile,
        join(root, "scripts", "sandbox", "debian"),
      ];
      expect(podmanCalls()).toEqual(Array(attempt).fill(build));
    }
  });

  test("install exits 1 when the build fails", () => {
    const result = cli(["install", "debian"], { FAKE_BUILD_EXIT: "1" });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      `Building ${DEBIAN_IMAGE} from scripts/sandbox/debian/Containerfile...\nSTEP 1/4: FROM debian\n`,
    );
    expect(result.stderr).toBe("Could not build the Debian image (podman build exited 1).\n");
  });

  test("run without the image exits 1 with the install hint and starts nothing", () => {
    const result = cli(["run", "debian", "--", "uname"], { FAKE_NO_IMAGE: "1" });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("No Debian image: run `bun run sandbox:install debian` first.\n");
    expect(podmanCalls()).toEqual([["image", "inspect", "--format", "{{.Size}}", DEBIAN_IMAGE]]);
  });

  test("run waits for systemd, copies, runs as goop, fetches and removes the container", () => {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.ts"), "export {};\n");

    const result = cli([
      "run",
      "debian",
      "--copy",
      "src",
      "--fetch",
      "/home/goop/goop/out.txt",
      "--",
      "make",
      "test",
    ]);

    const podman = podmanCalls();
    const { name, id } = debianRun(podman);
    const results = join(root, ".temp", "debian", "results", id);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        `Starting ${name}...`,
        "Waiting for systemd...",
        "systemd is running.",
        "Copying src to /home/goop/goop/...",
        "container output",
        `Fetched /home/goop/goop/out.txt into .temp/debian/results/${id}/`,
        `Removing ${name}...`,
        "",
      ].join("\n"),
    );
    expect(podman).toEqual([
      ["image", "inspect", "--format", "{{.Size}}", DEBIAN_IMAGE],
      ["run", "-d", "--name", name, "--systemd=always", DEBIAN_IMAGE],
      ["exec", name, "timeout", "30", "systemctl", "is-system-running", "--wait"],
      ["cp", join(root, "src"), `${name}:/home/goop/goop/`],
      ["exec", name, "chown", "-R", "goop:goop", "/home/goop/goop"],
      [...USER_EXEC, name, "bash", "-lc", "make test"],
      ["cp", `${name}:/home/goop/goop/out.txt`, `${results}/`],
      ["rm", "--force", "--time", "10", name],
    ]);
    expect(existsSync(results)).toBe(true);
  });

  test("run takes the command without --, with --engine before it (S1)", () => {
    const result = cli(["run", "debian", "--engine", "podman", "uname", "-a"]);

    const podman = podmanCalls();
    const { name } = debianRun(podman);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(podman.slice(-2)).toEqual([
      [...USER_EXEC, name, "bash", "-lc", "uname -a"],
      ["rm", "--force", "--time", "10", name],
    ]);
  });

  test("run returns the command's exit code and still removes the container when it fails", () => {
    const result = cli(["run", "debian", "--", "exit 3"], { FAKE_EXEC_EXIT: "3" });

    const podman = podmanCalls();
    const { name } = debianRun(podman);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        `Starting ${name}...`,
        "Waiting for systemd...",
        "systemd is running.",
        "container output",
        `Removing ${name}...`,
        "",
      ].join("\n"),
    );
    expect(podman.slice(-2)).toEqual([
      [...USER_EXEC, name, "bash", "-lc", "exit 3"],
      ["rm", "--force", "--time", "10", name],
    ]);
  });

  test("run says how to remove the container by hand when it cannot, and exits 1 instead of 0", () => {
    const result = cli(["run", "debian", "uname"], { FAKE_RM_FAIL: "1" });

    const podman = podmanCalls();
    const { name } = debianRun(podman);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      [
        `Starting ${name}...`,
        "Waiting for systemd...",
        "systemd is running.",
        "container output",
        `Removing ${name}...`,
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe(
      `Could not remove ${name}: Error: container is stuck. Remove it by hand: bun scripts/dev-env/run.ts podman --root ${join(root, ".local", "containers", "storage")} --runroot ${join(root, ".temp", "containers", "run")} rm -f ${name}\n`,
    );
    expect(podman.at(-1)).toEqual(["rm", "--force", "--time", "10", name]);
  });

  test("run keeps a failed command's exit code when the removal fails too", () => {
    const result = cli(["run", "debian", "exit 3"], { FAKE_EXEC_EXIT: "3", FAKE_RM_FAIL: "1" });

    const { name } = debianRun(podmanCalls());
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe(
      `Could not remove ${name}: Error: container is stuck. Remove it by hand: bun scripts/dev-env/run.ts podman --root ${join(root, ".local", "containers", "storage")} --runroot ${join(root, ".temp", "containers", "run")} rm -f ${name}\n`,
    );
  });

  test("run refuses to copy a path outside the repo before starting anything", () => {
    const result = cli(["run", "debian", "--copy", "../outside", "--", "uname"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Cannot copy ../outside: only existing paths inside the repo can be uploaded.\n",
    );
    expect(calls()).toEqual([]);
    expect(readdirSync(root)).toEqual([]);
  });

  test("status without the image says so and lists no containers", () => {
    const result = cli(["status", "debian"], { FAKE_NO_IMAGE: "1", FAKE_PS_EMPTY: "1" });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "Debian image: none (run `bun run sandbox:install debian`)\nRunning containers: none\n",
    );
    expect(podmanCalls()).toEqual([
      ["image", "inspect", "--format", "{{.Size}}", DEBIAN_IMAGE],
      ["ps", "--filter", "name=goop-debian", "--format", "{{.Names}}\t{{.Status}}"],
    ]);
  });

  test("status with the image prints its size and the running containers", () => {
    const result = cli(["status", "debian"], { FAKE_PS_NAME: "goop-debian-run-test" });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      `Debian image: ${DEBIAN_IMAGE} (117.7 MiB)\nRunning containers:\n  goop-debian-run-test\tUp 2 minutes\n`,
    );
  });
});

const DOCKER_SYSTEMD = [
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
];

describeOnLinuxHost("scripts/sandbox/cli.ts debian on Docker (S3, S4)", () => {
  test("install --engine docker builds the image once with docker build", () => {
    const result = cli(["install", "debian", "--engine", "docker"], {
      PATH: isolatedPath({ docker: FAKE_DOCKER }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(`${DOCKER_WARNING}\n`);
    expect(result.stdout).toBe(
      [
        `Building ${DEBIAN_IMAGE} from scripts/sandbox/debian/Containerfile...`,
        "STEP 1/4: FROM debian",
        `Debian image ${DEBIAN_IMAGE} is ready (0m 0s).`,
        "",
      ].join("\n"),
    );
    expect(dockerCalls()).toEqual([
      [
        "build",
        "--tag",
        DEBIAN_IMAGE,
        "--file",
        join(root, "scripts", "sandbox", "debian", "Containerfile"),
        join(root, "scripts", "sandbox", "debian"),
      ],
    ]);
  });

  test("install names docker when the build fails", () => {
    const result = cli(["install", "debian", "--engine", "docker"], {
      PATH: isolatedPath({ docker: FAKE_DOCKER }),
      FAKE_BUILD_EXIT: "1",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      `${DOCKER_WARNING}\nCould not build the Debian image (docker build exited 1).\n`,
    );
  });

  test("--engine docker wins over an installed Podman", () => {
    const result = cli(["status", "debian", "--engine", "docker"], {
      PATH: isolatedPath({ podman: FAKES.podman ?? "", docker: FAKE_DOCKER }),
      FAKE_PS_EMPTY: "1",
    });

    expect(result.exitCode).toBe(0);
    expect(calls().map((call) => call[0])).toEqual(["docker", "docker"]);
  });

  test("run --engine docker starts systemd, waits, execs as goop, removes the container and returns the exit code", () => {
    const result = cli(["run", "debian", "--engine", "docker", "uname", "-a"], {
      PATH: isolatedPath({ docker: FAKE_DOCKER }),
      FAKE_EXEC_EXIT: "3",
    });

    const docker = dockerCalls();
    const { name } = debianRun(docker);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe(`${DOCKER_WARNING}\n`);
    expect(result.stdout).toBe(
      [
        `Starting ${name}...`,
        "Waiting for systemd...",
        "systemd is running.",
        "container output",
        `Removing ${name}...`,
        "",
      ].join("\n"),
    );
    expect(docker).toEqual([
      ["image", "inspect", "--format", "{{.Size}}", DEBIAN_IMAGE],
      ["run", "-d", "--name", name, ...DOCKER_SYSTEMD, DEBIAN_IMAGE],
      ["exec", name, "timeout", "30", "systemctl", "is-system-running", "--wait"],
      [...USER_EXEC, name, "bash", "-lc", "uname -a"],
      ["rm", "--force", name],
    ]);
  });

  test("run --engine docker says how to remove the container with docker when it cannot", () => {
    const result = cli(["run", "debian", "--engine", "docker", "uname"], {
      PATH: isolatedPath({ docker: FAKE_DOCKER }),
      FAKE_RM_FAIL: "1",
    });

    const { name } = debianRun(dockerCalls());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      `${DOCKER_WARNING}\nCould not remove ${name}: Error: container is stuck. Remove it by hand: docker rm -f ${name}\n`,
    );
  });

  test("status --engine docker prints the image size and the running containers", () => {
    const result = cli(["status", "debian", "--engine", "docker"], {
      PATH: isolatedPath({ docker: FAKE_DOCKER }),
      FAKE_PS_NAME: "goop-debian-run-test",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(`${DOCKER_WARNING}\n`);
    expect(result.stdout).toBe(
      `Debian image: ${DEBIAN_IMAGE} (117.7 MiB)\nRunning containers:\n  goop-debian-run-test\tUp 2 minutes\n`,
    );
    expect(dockerCalls()).toEqual([
      ["image", "inspect", "--format", "{{.Size}}", DEBIAN_IMAGE],
      ["ps", "--filter", "name=goop-debian", "--format", "{{.Names}}\t{{.Status}}"],
    ]);
  });

  test("without --engine and only Docker installed it picks Docker and prints the storage warning", () => {
    const result = cli(["status", "debian"], {
      PATH: isolatedPath({ docker: FAKE_DOCKER }),
      FAKE_PS_EMPTY: "1",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(`${DOCKER_WARNING}\n`);
    expect(result.stdout).toBe(
      `Debian image: ${DEBIAN_IMAGE} (117.7 MiB)\nRunning containers: none\n`,
    );
    expect(calls().map((call) => call[0])).toEqual(["docker", "docker"]);
  });
});
