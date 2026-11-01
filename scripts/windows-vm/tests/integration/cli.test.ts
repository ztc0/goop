import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..", "..", "..", "..");
const cliScript = join(repo, "scripts", "windows-vm", "cli.ts");
const IMAGE = "docker.io/dockurr/windows:6.06";
const FAKE_PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTests";

const USAGE = `Usage: bun scripts/windows-vm/cli.ts <command>

Commands:
  install    Install Windows once into .local/windows/base/ (about 25 minutes)
  run [--copy <repo path>]... [--fetch <guest path>]... -- <PowerShell command...>
             Run a command in a throwaway VM over the base; the VM and its changes
             are deleted when it ends
  status     Show the Windows base and the running VMs
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
  *" ps "*) if [ -z "$FAKE_PS_EMPTY" ]; then printf 'goop-windows-run-test\\tUp 2 minutes\\n'; fi ;;
  *" logs "*) printf 'fake container log\\n' ;;
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
  fixture = join(repo, ".temp", "tests", `windows-vm-cli-${crypto.randomUUID()}`);
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

describe("scripts/windows-vm/cli.ts usage", () => {
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
    const result = cli(["run", "--copy"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`--copy needs a value.\n${USAGE}`);
    expect(calls()).toEqual([]);
  });
});

describe("scripts/windows-vm/cli.ts run", () => {
  test("without a base it exits 1 with the install hint and creates nothing", () => {
    const result = cli(["run", "--", "Get-Date"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("No Windows base: run `bun run windows:install` first.\n");
    expect(readdirSync(root)).toEqual([]);
    expect(calls()).toEqual([]);
  });

  test("runs on a throwaway overlay, stops the VM and deletes the run dir even when the command fails (S5)", () => {
    const base = seedBase();

    const result = cli(["run", "--", "Write-Output", "hi;", "exit", "3"], { FAKE_SSH_EXIT: "3" });

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

    const result = cli(["run", "--copy", "../outside", "--", "Get-Date"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Cannot copy ../outside: only existing paths inside the repo can be uploaded.\n",
    );
    expect(calls()).toEqual([]);
    expect(existsSync(join(root, ".temp"))).toBe(false);
  });
});

describe("scripts/windows-vm/cli.ts install", () => {
  test("refuses when a base already exists and never calls podman", () => {
    const base = seedBase();

    const result = cli(["install"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "A Windows base already exists in .local/windows/base/. Delete that folder to install again.\n",
    );
    expect(calls()).toEqual([]);
    expectBaseUnchanged(base);
  });

  test("generates the key, password and OEM files, waits for the marker, then stops and removes the container", () => {
    const result = cli(["install"]);

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

describe("scripts/windows-vm/cli.ts status", () => {
  test("without a base it says so and lists the running VMs", () => {
    const result = cli(["status"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "Windows base: none (run `bun run windows:install`)\nRunning VMs:\n  goop-windows-run-test\tUp 2 minutes\n",
    );
    expect(podmanCalls()).toEqual([
      ["ps", "--filter", "name=goop-windows", "--format", "{{.Names}}\t{{.Status}}"],
    ]);
  });

  test("with a base it prints its size, and none when no VM runs", () => {
    seedBase();

    const result = cli(["status"], { FAKE_PS_EMPTY: "1" });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("Windows base: .local/windows/base/ (24 B)\nRunning VMs: none\n");
  });
});
