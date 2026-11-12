# 0001. The encrypted store uses SQLite3MultipleCiphers through bun:ffi

Date: 2026-11-01. Status: accepted; where the native libraries are extracted is superseded by [0003](0003-native-libraries-in-a-private-folder.md).

## Context

goop keeps CVs, profiles, searches and chats on the user's machine, so the database must be encrypted at rest (S24). It also needs full-text search (FTS5) and vector search (sqlite-vec) on the same data (S17). All of it must run on Linux and Windows inside the single `bun build --compile` executable (S12).

S12 assumed `bun:sqlite` + SQLite3MultipleCiphers. The T10 spike showed that this cannot work. Bun links its SQLite statically on Linux and Windows, and `Database.setCustomSQLite()` works only on macOS. SQLite3MultipleCiphers (sqlite3mc) replaces SQLite; it is not a loadable extension. Details and sources: [`docs/research/spike-encrypted-sqlite.md`](../research/spike-encrypted-sqlite.md).

## Options

1. **`bun:sqlite` with a custom SQLite library.** Works on macOS only; the Linux pull requests were closed unmerged.
2. **An npm SQLite package with encryption** (`better-sqlite3-multiple-ciphers`, `@journeyapps/sqlcipher`). Neither loads in Bun.
3. **`libsql` with `encryptionKey`.** Loads in Bun, but its cipher is AES-256-CBC without an HMAC, so a tampered file is not detected. The project is being replaced by Turso Database.
4. **Turso Database.** Pre-1.0, with experimental encryption and a full-text search that is not FTS5.
5. **Encrypting rows in the application.** The search indexes would hold plaintext or stop working.
6. **sqlite3mc as a second SQLite copy, loaded through `bun:ffi`.** The spike passed every check on Linux, from source and from the compiled executable.

## Decision

The encrypted database uses sqlite3mc through `bun:ffi` (option 6):

- Features depend on an encrypted-store interface in `src/shared/types/`, never on sqlite3mc. One adapter in `src/shared/adapters/` implements it with the FFI wrapper. No other module calls sqlite3mc or `bun:ffi` for storage.
- The interface speaks goop's terms (open with a key, run a statement, run a transaction, full-text and vector queries), not `sqlite3_*` calls or pointers. A future engine, such as Turso Database or a Bun release that supports a custom SQLite on Linux and Windows, only needs a new adapter that passes the same contract tests.
- The cipher is sqlite3mc's default, ChaCha20-Poly1305.
- The key is set with `sqlite3_key` or `PRAGMA hexkey`, never as passphrase text in SQL, and is verified with a read of `sqlite_master`.
- sqlite-vec is loaded only into the sqlite3mc copy. `bun:sqlite` never loads it, because loading it into both copies crashes the process.
- Each database file is opened by exactly one SQLite copy, because the copies' locks do not see each other.
- The native libraries are embedded in the executable, copied to `GOOP_HOME/cache/native/<hash>/` and checked against sha256 values pinned at CI build time before every load.
- On Linux, CI builds sqlite3mc with `SQLITE3MC_USE_DISPATCH_TABLE` and FTS5 enabled. On Windows, CI uses the official DLL after checking that `PRAGMA compile_options` lists FTS5.

## Consequences

- Swapping the engine later means writing one adapter and running the shared contract tests against it; features and their tests do not change.
- goop maintains an FFI wrapper of about 300 lines. Its slot numbers are generated from `sqlite3ext.h` on every sqlite3mc upgrade, and a wrong FFI type crashes instead of throwing, so T16 covers the wrapper with tests.
- `bun:sqlite` is used only for stores that hold no personal data, if any.
- A test keeps sqlite-vec out of `bun:sqlite`.
- CI verifies the Cosign signature of sqlite3mc's `SHA256SUMS` before pinning hashes; the spike could not.
- The spike checks passed on Windows 11 too; the tampered-cache case and the `%LOCALAPPDATA%` default were not run there and are covered in T16.
- Turso Database stays a candidate to check again once its encryption and full-text search are stable. Moving to it would need a new ADR that supersedes this one.
