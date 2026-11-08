import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  APT_SNAPSHOT,
  COMPILE_FLAGS,
  DEBIAN_IMAGE,
  SQLITE3MC_LINUX,
  sqliteVersionOf,
  TOOLCHAIN,
} from "../../recipe";

const repo = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const RELEASE = "https://github.com/utelle/SQLite3MultipleCiphers/releases/download/v2.6.1";

describe("the sqlite3mc linux-x64 recipe", () => {
  test("pins the v2.6.1 amalgamation by https URL and sha256", () => {
    expect(SQLITE3MC_LINUX.name).toBe("sqlite3mc");
    expect(SQLITE3MC_LINUX.platform).toBe("linux-x64");
    expect(SQLITE3MC_LINUX.archive).toEqual({
      name: "sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip",
      url: `${RELEASE}/sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip`,
      sha256: "3f25af603566a23c821d8e581778b5ece2a541d2435776de57b8d845c176815a",
      maxBytes: 16 * 1024 * 1024,
    });
  });

  test("pins who signs the release's SHA256SUMS", () => {
    const small = 64 * 1024;
    expect(SQLITE3MC_LINUX.signed).toEqual({
      list: {
        name: "sqlite3mc-2.6.1-SHA256SUMS",
        url: `${RELEASE}/sqlite3mc-2.6.1-SHA256SUMS`,
        maxBytes: small,
      },
      signature: {
        name: "sqlite3mc-2.6.1-SHA256SUMS.sig",
        url: `${RELEASE}/sqlite3mc-2.6.1-SHA256SUMS.sig`,
        maxBytes: small,
      },
      certificate: {
        name: "sqlite3mc-2.6.1-SHA256SUMS.pem",
        url: `${RELEASE}/sqlite3mc-2.6.1-SHA256SUMS.pem`,
        maxBytes: small,
      },
      identity:
        "https://github.com/utelle/SQLite3MultipleCiphers/.github/workflows/build-reusable.yml@refs/heads/main",
      issuer: "https://token.actions.githubusercontent.com",
    });
  });

  test("pins the output that four reproducible builds gave", () => {
    expect(SQLITE3MC_LINUX.output).toEqual({
      file: "libsqlite3mc.so",
      sha256: "38380e83569117219e66b18175ff937a5ec738de9411444a0819c6327b55593f",
      sqliteVersion: "3.54.0",
    });
    expect(SQLITE3MC_LINUX.source.expected).toBe("3.54.0");
  });

  test("compiles with the dispatch table, FTS5, in-memory temp data and reproducible flags", () => {
    expect(COMPILE_FLAGS).toEqual([
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
    ]);
    expect(SQLITE3MC_LINUX.environment).toEqual({
      SOURCE_DATE_EPOCH: "1793491200",
      LC_ALL: "C",
      TZ: "UTC",
    });
  });

  test("the container takes one member out of the archive, compiles it and lists the toolchain", () => {
    expect(SQLITE3MC_LINUX.script).toBe(
      [
        "set -eu",
        "unzip -p /build/input/sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip sqlite3mc_amalgamation.c > /build/src/sqlite3mc_amalgamation.c",
        "cd /build/src",
        `gcc-14 ${COMPILE_FLAGS.join(" ")} -o /build/out/libsqlite3mc.so sqlite3mc_amalgamation.c -lm -lpthread`,
        // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal dpkg-query format
        "dpkg-query -W -f '${Package} ${Version}\\n' gcc-14 cpp-14 libgcc-14-dev binutils binutils-x86-64-linux-gnu libc6-dev unzip > /build/out/toolchain.txt",
      ].join("\n"),
    );
  });

  test("reads the version the amalgamation declares", () => {
    expect(SQLITE3MC_LINUX.source.file).toBe("sqlite3mc_amalgamation.c");
    expect(sqliteVersionOf('/* x */\n#define SQLITE_VERSION        "3.54.0"\n')).toBe("3.54.0");
    expect(sqliteVersionOf("#define SQLITE_VERSION_NUMBER 3054000\n")).toBeUndefined();
    expect(SQLITE3MC_LINUX.source.version).toBe(sqliteVersionOf);
  });
});

describe("the sqlite3mc Containerfile", () => {
  const containerfile = readFileSync(join(repo, SQLITE3MC_LINUX.containerfile), "utf8");

  test("starts from the pinned Debian 13 digest and installs from its snapshot", () => {
    expect(SQLITE3MC_LINUX.containerfile).toBe(
      "scripts/native-libs/sqlite3mc/linux-x64/Containerfile",
    );
    expect(DEBIAN_IMAGE).toBe(
      "docker.io/library/debian:trixie@sha256:e2914ec98e08b24b4cee3cefcb9f90dfb5519f8d215a2ccf0c9a49b10b6e43de",
    );
    expect(containerfile).toContain(`\nFROM ${DEBIAN_IMAGE}\n`);
    expect(containerfile.match(/^FROM /gm)).toHaveLength(1);
    expect(containerfile).toContain(`/archive/debian/${APT_SNAPSHOT} trixie main`);
    expect(containerfile).toContain(`/archive/debian-security/${APT_SNAPSHOT} trixie-security`);
  });

  test("installs exactly the pinned toolchain", () => {
    const installed = [...containerfile.matchAll(/^\s+([a-z0-9.+-]+)=(\S+) \\$/gm)].map(
      ([, name, version]) => ({ name, version }),
    );
    expect(installed).toEqual([...TOOLCHAIN]);
    expect(TOOLCHAIN).toEqual([
      { name: "gcc-14", version: "14.2.0-19" },
      { name: "cpp-14", version: "14.2.0-19" },
      { name: "libgcc-14-dev", version: "14.2.0-19" },
      { name: "binutils", version: "2.44-3" },
      { name: "binutils-x86-64-linux-gnu", version: "2.44-3" },
      { name: "libc6-dev", version: "2.41-12+deb13u4" },
      { name: "unzip", version: "6.0-29+deb13u1" },
    ]);
    expect(SQLITE3MC_LINUX.toolchain).toBe(TOOLCHAIN);
    expect(SQLITE3MC_LINUX.image).toBe("localhost/goop-native-libs-sqlite3mc:1");
  });
});
