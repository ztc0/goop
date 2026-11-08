// sqlite3mc (ADR 0001) for linux-x64: every input and the output are pinned here, so the same
// recipe gives the same library on any machine (docs/research/spike-encrypted-sqlite.md).
import type { LibraryRecipe, ToolchainPackage } from "../types/native-libs";

const RELEASE = "https://github.com/utelle/SQLite3MultipleCiphers/releases/download/v2.6.1";
const ARCHIVE = "sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip";
const MEMBER = "sqlite3mc_amalgamation.c";
const SMALL = 64 * 1024;

/**
 * docker.io/library/debian:trixie for linux/amd64, the same digest the Debian sandbox pins
 * (2026-11-03). Its `debian.sources` names the snapshot below.
 */
export const DEBIAN_IMAGE =
  "docker.io/library/debian:trixie@sha256:e2914ec98e08b24b4cee3cefcb9f90dfb5519f8d215a2ccf0c9a49b10b6e43de";

/** The Debian snapshot the Containerfile installs from, so no package version can move. */
export const APT_SNAPSHOT = "20261027T000000Z";

/** The compiler, assembler, linker, C library headers and unzip of the build image. */
export const TOOLCHAIN: readonly ToolchainPackage[] = [
  { name: "gcc-14", version: "14.2.0-19" },
  { name: "cpp-14", version: "14.2.0-19" },
  { name: "libgcc-14-dev", version: "14.2.0-19" },
  { name: "binutils", version: "2.44-3" },
  { name: "binutils-x86-64-linux-gnu", version: "2.44-3" },
  { name: "libc6-dev", version: "2.41-12+deb13u4" },
  { name: "unzip", version: "6.0-29+deb13u1" },
];

/**
 * gcc flags for `libsqlite3mc.so`. The dispatch table makes every SQLite symbol static, so this
 * copy cannot clash with Bun's own SQLite. `SQLITE_TEMP_STORE=3` keeps temporary data in memory
 * whatever `PRAGMA temp_store` says, because sqlite3mc does not encrypt temp files. The rest
 * makes the output reproducible: no debug data, paths mapped to `.`, a fixed random seed, a
 * baseline CPU, no build ID and stripped symbols. One translation unit is linked straight into
 * the library, so there is no `ar` step to make deterministic. Changing any flag changes the
 * output, so its pin below must change with it.
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

/** The first `#define SQLITE_VERSION "x.y.z"` of the amalgamation. */
export function sqliteVersionOf(source: string): string | undefined {
  return /^#define SQLITE_VERSION\s+"([^"]+)"/m.exec(source)?.[1];
}

export const SQLITE3MC_LINUX: LibraryRecipe = {
  name: "sqlite3mc",
  platform: "linux-x64",
  // The sha256 that the release's signed SHA256SUMS and GitHub's asset digest both give.
  archive: {
    name: ARCHIVE,
    url: `${RELEASE}/${ARCHIVE}`,
    sha256: "3f25af603566a23c821d8e581778b5ece2a541d2435776de57b8d845c176815a",
    maxBytes: 16 * 1024 * 1024,
  },
  signed: {
    list: {
      name: "sqlite3mc-2.6.1-SHA256SUMS",
      url: `${RELEASE}/sqlite3mc-2.6.1-SHA256SUMS`,
      maxBytes: SMALL,
    },
    signature: {
      name: "sqlite3mc-2.6.1-SHA256SUMS.sig",
      url: `${RELEASE}/sqlite3mc-2.6.1-SHA256SUMS.sig`,
      maxBytes: SMALL,
    },
    certificate: {
      name: "sqlite3mc-2.6.1-SHA256SUMS.pem",
      url: `${RELEASE}/sqlite3mc-2.6.1-SHA256SUMS.pem`,
      maxBytes: SMALL,
    },
    identity:
      "https://github.com/utelle/SQLite3MultipleCiphers/.github/workflows/build-reusable.yml@refs/heads/main",
    issuer: "https://token.actions.githubusercontent.com",
  },
  image: "localhost/goop-native-libs-sqlite3mc:1",
  containerfile: "scripts/native-libs/sqlite3mc/linux-x64/Containerfile",
  toolchain: TOOLCHAIN,
  // A fixed clock (2026-11-01, when the archive was pinned), locale and time zone.
  environment: { SOURCE_DATE_EPOCH: "1793491200", LC_ALL: "C", TZ: "UTC" },
  // Only pinned constants go in. `unzip -p` takes the one member out of the verified archive
  // into the fresh source folder, so no archive path can escape it.
  script: [
    "set -eu",
    `unzip -p /build/input/${ARCHIVE} ${MEMBER} > /build/src/${MEMBER}`,
    "cd /build/src",
    `gcc-14 ${COMPILE_FLAGS.join(" ")} -o /build/out/libsqlite3mc.so ${MEMBER} -lm -lpthread`,
    `dpkg-query -W -f '\${Package} \${Version}\\n' ${TOOLCHAIN.map((entry) => entry.name).join(" ")} > /build/out/toolchain.txt`,
  ].join("\n"),
  source: { file: MEMBER, label: "SQLite", expected: "3.54.0", version: sqliteVersionOf },
  // Four builds from this recipe gave this library: 1772240 bytes (odd/tasks/storage.md L26).
  output: {
    file: "libsqlite3mc.so",
    sha256: "38380e83569117219e66b18175ff937a5ec738de9411444a0819c6327b55593f",
    sqliteVersion: "3.54.0",
  },
};
