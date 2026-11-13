# Repo-local environment rules

Development never writes outside the repo. `scripts/dev-env/run.ts` sets these variables before every package script:

| Variable                | Points to           |
| ----------------------- | ------------------- |
| `GOOP_HOME`             | `.local/`           |
| `GOOP_RUNTIME_DIR`      | `.temp/run/`        |
| `BUN_INSTALL_CACHE_DIR` | `.local/cache/bun/` |
| `UV_CACHE_DIR`          | `.local/cache/uv/`  |
| `HF_HOME`               | `.local/cache/hf/`  |
| `TMPDIR`, `TMP`, `TEMP` | `.temp/tmp/`        |

Without `GOOP_HOME`, goop uses the normal user paths (XDG on Linux, `%APPDATA%` and `%LOCALAPPDATA%` on Windows).

## `.local/`: persistent

`config/`, `data/`, `state/`, `cache/{bun,uv,hf}/`, `models/`, `bin/`, `build/`, and `lib/native/` once a built `goop` runs with it (the native libraries it extracts, never a cache). Kept between sessions; only `bun run clean:local` deletes it, after typing `delete`.

## `.temp/`: disposable

`tmp/`, `tests/`, `downloads/` (partial files, moved to `.local/models/` after the hash check), `extract/` (a fresh folder per archive), `scratch/` (agent work), `run/` (the socket). `bun run clean` deletes it at any time.

`run/` must be 0700, since the channel refuses a runtime folder other users can open: `scripts/dev-env/run.ts` creates it 0700 and tightens it to 0700 when it is a folder we own. A symbolic link or a folder owned by someone else is left unchanged, for the channel to refuse.

## Running goop from source

`goop` never starts the daemon, so run each mode in its own terminal:

```sh
bun run dev daemon   # the daemon, restarted on file changes; Ctrl-C stops it and removes the socket
bun run dev          # goop, which connects to it
```

## What stays out of development

Things that must touch the system are not installed while developing: the systemd timer, the Windows scheduled task, TPM credentials, the keyring and DPAPI. The real TPM and DPAPI are exercised only in their spike, with the maintainer's permission, and undone afterwards.

The vault lives in `<GOOP_HOME>/data/` (`.local/data/`). goop uses the OS key store only as the compiled executable without `GOOP_HOME`.

## The insecure development key

From source with `GOOP_HOME` in the repo's `.local/` (what `bun run dev` sets), a fake OS key store seals the data key instead: a random key kept in plain text in `.temp/dev/INSECURE-DEV-KEY` (0600, in a 0700 folder). The first `goop` still asks for a passphrase to set the vault up; after that every daemon start unlocks by itself and prints:

```text
goop daemon is using the insecure development key in .temp/dev/ (never use this for real data).
```

- Anyone who can read the file can open the vault: never put real data in a development vault.
- It never exists outside development: the compiled executable never uses it, whatever its environment, and no environment variable turns it on. From source with `GOOP_HOME` anywhere else (the tests' folders under `.temp/tests/`), the passphrase seals the data key as before.
- When `GOOP_HOME` is in `.local/` but the folder above `src/` is not the goop repository (its `package.json` is not named `goop`), the daemon refuses to start.
- `bun run clean` deletes it with the rest of `.temp/`. A vault sealed with it then needs its recovery key, which seals the data key with a new development key; to start over, delete `.local/data/` too.
