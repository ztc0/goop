import { describe, expect, test } from "bun:test";
import { sandboxPaths } from "../../../sandbox/model/paths";
import { describeOnLinuxHost } from "../../../sandbox/tests/linux-host";
import {
  BUILD_ENVIRONMENT,
  BUILD_IMAGE,
  buildEngine,
  COMPILE_FLAGS,
  containerScript,
  nativeRunArgs,
} from "../../model/compile";
import { SQLITE3MC_ARCHIVE, TOOLCHAIN } from "../../model/inputs";

const dirs = { download: "/r/.temp/downloads/d1", extract: "/r/.temp/extract/e1", out: "/r/o1" };

describe("compile settings (S8)", () => {
  test("pins the archive, its hash and the SQLite version", () => {
    expect(SQLITE3MC_ARCHIVE).toEqual({
      name: "sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip",
      url: "https://github.com/utelle/SQLite3MultipleCiphers/releases/download/v2.6.1/sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip",
      sha256: "3f25af603566a23c821d8e581778b5ece2a541d2435776de57b8d845c176815a",
      member: "sqlite3mc_amalgamation.c",
      sqliteVersion: "3.54.0",
    });
  });

  test("pins the toolchain of the build image", () => {
    expect(TOOLCHAIN).toEqual([
      { name: "gcc-14", version: "14.2.0-19" },
      { name: "cpp-14", version: "14.2.0-19" },
      { name: "libgcc-14-dev", version: "14.2.0-19" },
      { name: "binutils", version: "2.44-3" },
      { name: "binutils-x86-64-linux-gnu", version: "2.44-3" },
      { name: "libc6-dev", version: "2.41-12+deb13u4" },
      { name: "unzip", version: "6.0-29+deb13u1" },
    ]);
  });

  test("builds the dispatch table with FTS5, memory-only temp data and reproducible output", () => {
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
    expect(BUILD_ENVIRONMENT).toEqual({
      SOURCE_DATE_EPOCH: "1793491200",
      LC_ALL: "C",
      TZ: "UTC",
    });
  });

  test("the container script takes one file out of the archive, compiles it and lists the toolchain", () => {
    expect(containerScript()).toBe(
      [
        "set -eu",
        "unzip -p /build/input/sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip sqlite3mc_amalgamation.c > /build/src/sqlite3mc_amalgamation.c",
        "cd /build/src",
        `gcc-14 ${COMPILE_FLAGS.join(" ")} -o /build/out/libsqlite3mc.so sqlite3mc_amalgamation.c -lm -lpthread`,
        // biome-ignore lint/suspicious/noTemplateCurlyInString: dpkg-query's own format.
        "dpkg-query -W -f '${Package} ${Version}\\n' gcc-14 cpp-14 libgcc-14-dev binutils binutils-x86-64-linux-gnu libc6-dev unzip > /build/out/toolchain.txt",
      ].join("\n"),
    );
  });

  test("every word put into the script is plain: no quotes, spaces or shell characters", () => {
    const words = [
      SQLITE3MC_ARCHIVE.name,
      SQLITE3MC_ARCHIVE.member,
      ...COMPILE_FLAGS,
      ...TOOLCHAIN.map((entry) => entry.name),
    ];
    for (const word of words) expect(word).toMatch(/^[\w.,=/+-]+$/);
  });
});

describeOnLinuxHost("the build engine (S8)", () => {
  const paths = sandboxPaths("/r");

  test("Podman runs with the sandbox's repo-local storage", () => {
    expect(buildEngine("podman", paths, 1000, 1000)).toEqual({
      name: "podman",
      command: [
        "podman",
        "--root",
        "/r/.local/containers/storage",
        "--runroot",
        "/r/.temp/containers/run",
        "--tmpdir",
        "/r/.temp/containers/tmp",
      ],
      env: { TMPDIR: "/r/.temp/containers/tmp" },
    });
  });

  test("Docker runs the build as the host user", () => {
    expect(buildEngine("docker", paths, 1000, 1001)).toEqual({
      name: "docker",
      command: ["docker"],
      env: {},
      user: "1000:1001",
    });
  });

  test("a fresh container without network, capabilities or a writable root", () => {
    const podman = buildEngine("podman", paths, 1000, 1000);
    const common = [
      "run",
      "--rm",
      "--network=none",
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--cap-drop=all",
      "--env",
      "SOURCE_DATE_EPOCH=1793491200",
      "--env",
      "LC_ALL=C",
      "--env",
      "TZ=UTC",
      "-v",
      "/r/.temp/downloads/d1:/build/input:ro",
      "-v",
      "/r/.temp/extract/e1:/build/src",
      "-v",
      "/r/o1:/build/out",
    ];
    expect(BUILD_IMAGE).toBe("localhost/goop-native-build:1");
    expect(nativeRunArgs(podman, dirs)).toEqual([
      ...common,
      "localhost/goop-native-build:1",
      "sh",
      "-c",
      containerScript(),
    ]);
    expect(nativeRunArgs(buildEngine("docker", paths, 1000, 1001), dirs)).toEqual([
      ...common,
      "--user",
      "1000:1001",
      "localhost/goop-native-build:1",
      "sh",
      "-c",
      containerScript(),
    ]);
  });
});
