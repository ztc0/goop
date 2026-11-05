import type { PinnedArchive, ToolchainPackage } from "../types/native-build";

/**
 * The sqlite3mc amalgamation (ADR 0001), pinned by the sha256 listed in the release's
 * `sqlite3mc-2.6.1-SHA256SUMS` (docs/research/spike-encrypted-sqlite.md). The Cosign signature of
 * that file is checked by the CI job, not here.
 */
export const SQLITE3MC_ARCHIVE: PinnedArchive = {
  name: "sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip",
  url: "https://github.com/utelle/SQLite3MultipleCiphers/releases/download/v2.6.1/sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip",
  sha256: "3f25af603566a23c821d8e581778b5ece2a541d2435776de57b8d845c176815a",
  member: "sqlite3mc_amalgamation.c",
  sqliteVersion: "3.54.0",
};

/**
 * The Debian snapshot the build image installs from: the one the pinned `debian:trixie` image was
 * built from (its `debian.sources` names it), so every package version is fixed.
 */
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
