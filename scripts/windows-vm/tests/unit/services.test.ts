import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { nodeFileStore } from "../../adapters/file-store";
import { createGuestShell } from "../../adapters/guest-shell";
import { createPodman } from "../../adapters/podman";
import { windowsVmPaths } from "../../model/paths";
import { installWindows } from "../../services/install";
import { runInWindows } from "../../services/run";
import type {
  Clock,
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
  WindowsVmDeps,
} from "../../types/windows-vm";

const repo = resolve(import.meta.dir, "..", "..", "..", "..");

class FakeRunner implements ProcessRunner {
  readonly calls: ProcessRequest[] = [];
  constructor(private readonly reply: (request: ProcessRequest) => Partial<ProcessResult>) {}

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.calls.push(request);
    return { exitCode: 0, stdout: "", stderr: "", ...this.reply(request) };
  }

  /** Podman subcommands without the program name and the six global flags. */
  podman(): string[][] {
    return this.calls
      .filter((call) => call.command[0] === "podman")
      .map((call) => call.command.slice(7));
  }
}

class FakeClock implements Clock {
  current = 0;
  now(): number {
    return this.current;
  }
  async sleep(ms: number): Promise<void> {
    this.current += ms;
  }
}

let fixture: string;
let lines: string[];

beforeEach(() => {
  fixture = join(repo, ".temp", "tests", `windows-vm-services-${crypto.randomUUID()}`);
  mkdirSync(fixture, { recursive: true });
  lines = [];
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function deps(runner: FakeRunner, clock: Clock, signal = new AbortController().signal) {
  const paths = windowsVmPaths(fixture);
  const result: WindowsVmDeps = {
    paths,
    podman: createPodman(runner, paths),
    guest: createGuestShell(runner, paths),
    files: nodeFileStore,
    clock,
    output: {
      info: (line) => lines.push(`out: ${line}`),
      error: (line) => lines.push(`err: ${line}`),
    },
    random: { bytes: (count) => new Uint8Array(count).fill(7) },
    signal,
  };
  return result;
}

function seedBase(): void {
  const base = join(fixture, ".local", "windows", "base");
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, "data.qcow2"), "base-disk");
  writeFileSync(join(base, "windows.vars"), "uefi-vars");
}

describe("installWindows", () => {
  test("on timeout prints the container logs, stops and removes it, and exits 1", async () => {
    const ssh = join(fixture, ".local", "windows", "ssh");
    mkdirSync(ssh, { recursive: true });
    writeFileSync(join(ssh, "id_ed25519"), "private");
    writeFileSync(
      join(ssh, "id_ed25519.pub"),
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTests goop-windows-vm\n",
    );
    const runner = new FakeRunner((request) => {
      if (request.command[0] === "ssh") return { exitCode: 255 };
      if (request.command.includes("logs")) return { stdout: "boot log line\n" };
      return {};
    });
    const clock = new FakeClock();

    const code = await installWindows(deps(runner, clock));

    expect(code).toBe(1);
    expect(clock.current).toBe(3_600_000);
    expect(runner.calls.filter((call) => call.command[0] === "ssh")).toHaveLength(361);
    const podman = runner.podman();
    expect(podman[0]?.slice(0, 4)).toEqual(["run", "-d", "--name", "goop-windows-install"]);
    expect(podman.slice(1)).toEqual([
      ["logs", "--tail", "50", "goop-windows-install"],
      ["stop", "-t", "120", "goop-windows-install"],
      ["rm", "goop-windows-install"],
    ]);
    expect(lines).toContain("err: Windows was not ready after 60m 0s. Last container logs:");
    expect(lines).toContain("err: boot log line");
    expect(lines).toContain("out: Still installing (59m 50s elapsed)...");
  });
});

describe("runInWindows", () => {
  test("when the overlay cannot be created, no VM starts and the run dir is deleted", async () => {
    seedBase();
    const runner = new FakeRunner((request) =>
      request.command.includes("--entrypoint")
        ? { exitCode: 125, stderr: "Error: qemu-img not found\n" }
        : {},
    );

    const code = await runInWindows(
      deps(runner, new FakeClock()),
      { copy: [], fetch: [], command: "Get-Date" },
      "r1",
    );

    expect(code).toBe(1);
    expect(runner.podman().map((args) => args[0])).toEqual(["run"]);
    expect(lines).toContain("err: Could not create the throwaway disk: Error: qemu-img not found");
    expect(readdirSync(join(fixture, ".temp", "windows", "runs"))).toEqual([]);
  });

  test("Ctrl+C while waiting stops the VM, deletes the run dir and exits 130", async () => {
    seedBase();
    const controller = new AbortController();
    const runner = new FakeRunner((request) => {
      if (request.command[0] === "ssh") {
        controller.abort();
        return { exitCode: 255 };
      }
      return {};
    });

    const code = await runInWindows(
      deps(runner, new FakeClock(), controller.signal),
      { copy: [], fetch: [], command: "Get-Date" },
      "r2",
    );

    expect(code).toBe(130);
    expect(runner.podman().at(-1)).toEqual(["stop", "-t", "120", "goop-windows-run-r2"]);
    expect(lines).toContain("err: Interrupted.");
    expect(existsSync(join(fixture, ".temp", "windows", "runs", "r2"))).toBe(false);
  });
});
