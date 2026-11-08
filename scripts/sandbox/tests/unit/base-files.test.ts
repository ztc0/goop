import { describe, expect, test } from "bun:test";
import { baseFilesToCopy, formatBytes, resolveCopyPath } from "@scripts/sandbox/model/base-files";
import { passwordFromBytes, runContainerName, runId } from "@scripts/sandbox/model/vm-config";
import { describeOnLinuxHost } from "@scripts/sandbox/tests/linux-host";

describe("baseFilesToCopy", () => {
  test("copies the small files and skips the disk and any ISO, sorted", () => {
    expect(
      baseFilesToCopy([
        "windows.vars",
        "data.qcow2",
        "win11x64.iso",
        "windows.rom",
        "WIN.ISO",
        "windows.base",
      ]),
    ).toEqual(["windows.base", "windows.rom", "windows.vars"]);
  });
});

describeOnLinuxHost("resolveCopyPath", () => {
  test("resolves paths inside the repo", () => {
    expect(resolveCopyPath("/repo", "src")).toBe("/repo/src");
    expect(resolveCopyPath("/repo", "./package.json")).toBe("/repo/package.json");
    expect(resolveCopyPath("/repo", "/repo/src/main.ts")).toBe("/repo/src/main.ts");
  });

  test("refuses the repo root itself and anything outside it", () => {
    expect(resolveCopyPath("/repo", ".")).toBeUndefined();
    expect(resolveCopyPath("/repo", "../outside")).toBeUndefined();
    expect(resolveCopyPath("/repo", "/etc/passwd")).toBeUndefined();
    expect(resolveCopyPath("/repo", "/repository/x")).toBeUndefined();
  });
});

describe("formatBytes", () => {
  test("uses binary units with one decimal", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MiB");
    expect(formatBytes(Math.round(12.34 * 1024 ** 3))).toBe("12.3 GiB");
  });
});

describe("run ids, container names and the password", () => {
  test("a run id is a UTC timestamp plus a suffix", () => {
    expect(runId(new Date(Date.UTC(2026, 10, 1, 9, 5, 3)), "a1b2")).toBe("20261101-090503-a1b2");
    expect(runContainerName("20261101-090503-a1b2")).toBe("goop-windows-run-20261101-090503-a1b2");
  });

  test("the password is the hex of the random bytes", () => {
    expect(passwordFromBytes(new Uint8Array([0, 255, 16]))).toBe("00ff10");
  });
});
