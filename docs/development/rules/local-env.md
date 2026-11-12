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

The vault lives in `<GOOP_HOME>/data/` (`.local/data/`). goop uses the OS key store only as the compiled executable without `GOOP_HOME`; from source or with `GOOP_HOME` the passphrase seals the data key, so the first `goop` asks for one and every daemon start waits locked until `goop` unlocks it. There is no insecure development key yet.
