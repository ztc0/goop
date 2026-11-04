import { podmanEnvironment, podmanGlobalArgs } from "../../sandbox/model/podman-args";
import type { EngineName, SandboxPaths } from "../../sandbox/types/sandbox";
import type { BuildEngine } from "../types/native-build";
import { SQLITE3MC_ARCHIVE, TOOLCHAIN } from "./inputs";

/** The image `native:build` builds from `scripts/native/linux/Containerfile`; bump it when that changes. */
export const BUILD_IMAGE = "localhost/goop-native-build:1";

/**
 * gcc flags for `libsqlite3mc.so`. The dispatch table makes every SQLite symbol static, so this
 * copy cannot clash with Bun's own SQLite (ADR 0001). `SQLITE_TEMP_STORE=3` keeps temporary
 * data in memory whatever `PRAGMA temp_store` says, because sqlite3mc does not encrypt temp
 * files (L22). The rest makes the output reproducible: no debug data, paths mapped to `.`, a
 * fixed random seed, a baseline CPU, no build ID and stripped symbols. It is one translation unit
 * linked straight into the library, so there is no `ar` step to make deterministic.
 */
export const COMPILE_FLAGS: readonly string[] = [
  "-O2",
  "-g0",
  "-fPIC",
  "-shared",
  "-march=x86-64",
  "-mtune=generic",
  "-fstack-protector-strong",
  "-ffile-prefix-map=/build/src=.",
  "-fdebug-prefix-map=/build/src=.",
  "-frandom-seed=sqlite3mc",
  "-DSQLITE3MC_USE_DISPATCH_TABLE",
  "-DSQLITE_ENABLE_FTS5",
  "-DSQLITE_THREADSAFE=1",
  "-DSQLITE_TEMP_STORE=3",
  "-Wl,--build-id=none",
  "-Wl,-z,relro",
  "-Wl,-z,now",
  "-Wl,-z,noexecstack",
  "-s",
];

/** A fixed clock (2026-11-01, when the archive was pinned), locale and time zone. */
export const BUILD_ENVIRONMENT: Readonly<Record<string, string>> = {
  SOURCE_DATE_EPOCH: "1793491200",
  LC_ALL: "C",
  TZ: "UTC",
};

/**
 * What the container runs. Only pinned constants go into it. `unzip -p` takes the one member out
 * of the verified archive into the fresh source folder, so no archive path can escape it.
 */
export function containerScript(): string {
  const { name, member } = SQLITE3MC_ARCHIVE;
  const packages = TOOLCHAIN.map((entry) => entry.name).join(" ");
  return [
    "set -eu",
    `unzip -p /build/input/${name} ${member} > /build/src/${member}`,
    "cd /build/src",
    `gcc-14 ${COMPILE_FLAGS.join(" ")} -o /build/out/libsqlite3mc.so ${member} -lm -lpthread`,
    `dpkg-query -W -f '\${Package} \${Version}\\n' ${packages} > /build/out/toolchain.txt`,
  ].join("\n");
}

/** The sandbox's engine, with Podman's repo-local storage flags or Docker as the host user. */
export function buildEngine(
  name: EngineName,
  paths: SandboxPaths,
  uid: number,
  gid: number,
): BuildEngine {
  return name === "podman"
    ? { name, command: ["podman", ...podmanGlobalArgs(paths)], env: podmanEnvironment(paths) }
    : { name, command: ["docker"], env: {}, user: `${uid}:${gid}` };
}

export interface BuildDirectories {
  /** Holds only the verified archive; mounted read-only. */
  download: string;
  /** Receives the extracted source. */
  extract: string;
  /** Receives the library and the toolchain list. */
  out: string;
}

/** A throwaway container with no network, no capabilities and a read-only root file system. */
export function nativeRunArgs(engine: BuildEngine, dirs: BuildDirectories): string[] {
  return [
    "run",
    "--rm",
    "--network=none",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--cap-drop=all",
    ...Object.entries(BUILD_ENVIRONMENT).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    "-v",
    `${dirs.download}:/build/input:ro`,
    "-v",
    `${dirs.extract}:/build/src`,
    "-v",
    `${dirs.out}:/build/out`,
    ...(engine.user === undefined ? [] : ["--user", engine.user]),
    BUILD_IMAGE,
    "sh",
    "-c",
    containerScript(),
  ];
}
