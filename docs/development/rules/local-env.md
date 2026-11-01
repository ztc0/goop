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

`config/`, `data/`, `state/`, `cache/{bun,uv,hf}/`, `models/`, `bin/`, `build/`. Kept between sessions; only `bun run clean:local` deletes it, after typing `delete`.

## `.temp/`: disposable

`tmp/`, `tests/`, `downloads/` (partial files, moved to `.local/models/` after the hash check), `extract/` (a fresh folder per archive), `scratch/` (agent work), `run/` (the socket). `bun run clean` deletes it at any time.

## What stays out of development

Things that must touch the system are not installed while developing: the systemd timer, the Windows scheduled task, TPM credentials, the keyring and DPAPI. Development uses a clearly marked insecure key in `.local/`. The real TPM and DPAPI are exercised only in their spike, with the maintainer's permission, and undone afterwards.
