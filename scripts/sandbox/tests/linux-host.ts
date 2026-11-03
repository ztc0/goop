import { describe } from "bun:test";

/**
 * The Windows VM runs on a Linux host only (KVM and rootless Podman). Suites that build
 * POSIX host paths or run fake POSIX tools skip on a Windows runner instead of failing there.
 */
export const describeOnLinuxHost = describe.skipIf(process.platform === "win32");
