# native-library: build, ship and load sqlite3mc from scratch

Redo of the native library after `scripts/native/` was removed (`odd/tasks/storage.md` L39). One script downloads and builds sqlite3mc into `.local/`; `src/shared/vault/` checks the binary and loads it; the sandbox gives each test machine the binary for its system.
Branch from `refactor/remove-native`. Test-first, native review on high-risk units, stacked pull requests of about 400 lines (`docs/development/rules/commits.md`).

## Specs

- **S1.** "y si usamos un srcipts para descargar y compilar ya que eso se genera simpre y lo hacemos en .locla del repo": one script downloads the pinned sqlite3mc source and builds the library into `.local/build/native/<platform>/`. The binary is generated, never committed: git holds only the recipe and the pins.
- **S2.** The script verifies before it trusts: the Cosign signature of sqlite3mc's `SHA256SUMS` (signer identity and issuer pinned), then the pinned sha256 of the archive; after the build, the library's sha256 must equal its pin, or nothing is written. It writes `.local/build/native/manifest.json` with each platform's file name, sha256 and SQLite version.
- **S3.** Windows uses sqlite3mc's official DLL, downloaded by the same script and verified the same way (signature, pinned sha256), into `.local/build/native/win32-x64/`, after checking that it lists FTS5.
- **S4.** "y el ./src/shared/vault/ compuruve la firma y el uso del binario": `src/shared/vault/native/` checks the library's sha256 against the manifest before every load and refuses a mismatch; `src/shared/vault/storage/` loads only a path that `vault/native` returned. The signature is checked once, by the script, when the source is downloaded; at run time goop checks the hash.
- **S5.** "la preguta como lo va a usar el binario": while developing (`bun run dev`, `bun run test`), goop and the tests load the library from `.local/build/native/<platform>/` through `vault/native`. There is one path: the spike's `.local/build/sqlite/` is no longer used.
- **S6.** In the distributed executable, `bun run build` embeds the library and the manifest. At start, goop reads the library's bytes from itself, `vault/native` checks the sha256, writes it to a private folder (`<GOOP_HOME>/lib/native/<sha256>/`, mode 0700, not a cache folder) and returns that path for `dlopen`. goop does this extraction itself, never through Bun's automatic one (oven-sh/bun#30717, #30962, #44083).
- **S7.** "ok eso esta bien pero el sandbox como hacemos esto para elo test vm": `sandbox:test` copies into each test machine only the platform folder it needs and the manifest: `linux-x64/` for the Debian container and the Debian VM (sandbox T7), `win32-x64/` for the Windows VM. The library is never built inside a test machine. If it is missing, `sandbox:test` stops with a clear error naming the command to run; the native tests never skip there. Nothing else from `.local/` is copied.
- **S8.** The script does not import another tool's internals (`docs/development/rules/architecture.md`): what it shares with `scripts/sandbox/` (engine choice, container arguments, process runner, downloads) lives in `scripts/shared/` behind its own entry.
- **S9.** CI runs the same script, enforces the pins, uploads the library and the manifest as an artifact, and attests them on pushes to `dev` and `main`; the test jobs use that artifact, so the native tests stop skipping on Linux and Windows.

## Tasks

| ID  | Specs  | Task                                                                                                       | Route  | Commit |
| --- | ------ | ---------------------------------------------------------------------------------------------------------- | ------ | ------ |
| T1  | S8     | Move the container tooling `scripts/sandbox/` and the script share into `scripts/shared/` with an entry    | inline | -      |
| T2  | S1, S2 | The script: pinned inputs, Cosign check, archive hash, reproducible Linux build, output pin, manifest      | inline | -      |
| T3  | S3     | Windows: download and verify the official DLL, check FTS5, add it to the manifest                          | inline | -      |
| T4  | S4, S5 | `vault/native` reads the manifest and loads from `.local/build/native/<platform>/`; the tests use one path | inline | -      |
| T5  | S7     | `sandbox:test` copies the platform folder and the manifest; missing library is an error, not a skip        | inline | -      |
| T6  | S6     | `bun run build` embeds the library and manifest; goop extracts to `<GOOP_HOME>/lib/native/<sha256>/`       | inline | -      |
| T7  | S9     | CI job: run the script, enforce pins, upload and attest; test jobs use the artifact                        | inline | -      |

Open question, for the maintainer: the script's folder name (S8 keeps it independent of `scripts/sandbox/`). Proposed: `scripts/sqlite3mc/`, named for what it builds.

## Log

- **L1.** The maintainer (verbatim): `y si usamos un srcipts para descargar y compilar ya que eso se genera simpre y lo hacemos en .locla del repo y el ./src/shared/vault/ compuruve la firma y el uso del binario. la preguta como lo va a usar el binario`; then `ok eso esta bien pero el sandbox como hacemos esto para elo test vm`; then `dale` to writing this plan before any code.
- **L2.** Context: `scripts/native/` was removed in `821ce02` (`odd/tasks/storage.md` L39). Kept findings: four builds gave `38380e83569117219e66b18175ff937a5ec738de9411444a0819c6327b55593f`; sqlite3mc v2.6.1 signs `SHA256SUMS` with Cosign keyless, identity `https://github.com/utelle/SQLite3MultipleCiphers/.github/workflows/build-reusable.yml@refs/heads/main`, issuer `https://token.actions.githubusercontent.com`; Rekor is blocked from the maintainer's host, so the full Cosign check first runs in CI. The maintainer's own research proposed a `src/shared/database/` module with the binary under `native/`; analysis: the module and single-entry rules already hold in `vault/` (`storage/`, `native/`), but a compiled binary must not live in `src/` or git (unreviewable bytes, breaks the CI chain of trust, one per platform), and sqlite3mc replaces SQLite rather than loading as an extension.
- **L3.** Testing rule (`docs/development/rules/testing.md`, "Real systems"; the maintainer: `no me dice tu que no se puede hacer en windows`): the native tests must run in every sandbox and in CI, never skip there.
