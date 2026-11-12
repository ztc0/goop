# 0003. Native libraries are extracted to a private folder, not a cache

Date: 2026-11-12. Status: accepted. Supersedes the extraction folder of [0001](0001-encrypted-store-through-sqlite3mc-ffi.md).

## Context

[0001](0001-encrypted-store-through-sqlite3mc-ffi.md) decided that the native libraries are embedded in the executable and copied to `GOOP_HOME/cache/native/<hash>/` before every load. Building the distributed executable (native-library T6, S6) showed two problems with that folder:

- A cache is something a user or a cleaning tool may delete at any time. Deleting this folder while goop runs, or replacing its files, is not harmless: it holds the code goop loads.
- Bun can extract embedded native files by itself, into a temporary folder it chooses, and the extracted copy is outside goop's checks (oven-sh/bun#30717, #30962, #44083).

## Options

1. **Keep `cache/native/`.** No change, but the folder keeps the meaning of a cache.
2. **Let Bun extract the library.** Less code, but goop cannot check the copy before it is loaded, nor choose where it lives.
3. **goop extracts it itself to a private folder, `GOOP_HOME/lib/native/<sha256>/`.** The folder is 0700 and the file read-only; goop checks the bytes against the pinned sha256 before writing and before every load.

## Decision

Option 3. goop reads the library's bytes from itself, checks them against the manifest's sha256, writes them to `GOOP_HOME/lib/native/<sha256>/` (folder 0700, file read-only), checks the copy again before every load, and never relies on Bun's automatic extraction. While developing, goop loads the library built in `.local/build/native/<platform>/` instead, with the same hash check.

## Consequences

- The folder is part of goop's installation, like `lib/` on any system; tools that clean caches leave it alone.
- A copy whose bytes or modes changed is replaced and checked again; the check before `dlopen` is not atomic with the load, a same-user gap 0001 already accepts.
- The extraction code lives in `src/shared/vault/native/` and is covered by unit tests, a compiled-executable test and the sandbox runs on Linux and Windows.
