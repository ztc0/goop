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

`config/`, `data/`, `state/`, `cache/{bun,uv,hf}/`, `models/`, `bin/`, `build/`, `containers/storage/` (Podman's images and containers), `dev/` (the dev container's `node_modules/` and the `bun.lock` hash it was installed from), and `lib/native/` once a built `goop` runs with it (the native libraries it extracts, never a cache). Kept between sessions; only `bun run clean:local` deletes it, after typing `delete`.

## `.temp/`: disposable

`tmp/`, `tests/`, `downloads/` (partial files, moved to `.local/models/` after the hash check), `extract/` (a fresh folder per archive), `scratch/` (agent work), `run/` (the socket), `dev/` (`bun run dev`: goop's data in `home/` and the insecure development key). `bun run clean` deletes it at any time.

`run/` must be 0700, since the channel refuses a runtime folder other users can open: `scripts/dev-env/run.ts` creates it 0700 and tightens it to 0700 when it is a folder we own. A symbolic link or a folder owned by someone else is left unchanged, for the channel to refuse.

## Running goop from source

`bun run dev` runs goop in a light container, `goop-dev` (image `localhost/goop-dev:1`, built once from `scripts/dev/Containerfile`: the pinned Debian 13 base and the pinned Bun). The container's main process is the daemon, restarted on every source change; `bun run dev` starts it when it is not running, waits for its socket, then runs goop in it:

```sh
bun run dev          # goop (the TUI); the first run builds the image and installs the packages
bun run dev --help   # every argument goes to goop
bun run dev:logs     # follow the daemon's output; Ctrl-C stops following
bun run dev:stop     # remove the container; .temp/dev/ and .local/dev/ are kept
```

- The repo is mounted at the same path inside, so goop's repo checks hold; nothing is copied and a source change never rebuilds the image.
- `node_modules/` inside is `.local/dev/node_modules/`, mounted over the repo's: `bun install --frozen-lockfile --ignore-scripts` fills it on the first start and again only when the hash of `bun.lock` changes.
- The container sets every variable, with no `.env` (S11): `GOOP_HOME=.temp/dev/home`, `GOOP_RUNTIME_DIR=/tmp/goop-run` (a private folder in the container, not on the mount), `BUN_INSTALL_CACHE_DIR=.local/cache/bun`, `TMPDIR=.temp/tmp`, `HOME=/tmp`. goop runs with `--no-env-file`.
- It runs with no capabilities and `no-new-privileges`. Podman (preferred) keeps images and containers in `.local/containers/storage/`; Docker keeps them in its own storage and runs the container as your user.
- `bun run clean` resets goop's data and the development key together; run `bun run dev:stop` first so the daemon does not keep the old vault open.

## What stays out of development

Things that must touch the system are not installed while developing: the systemd timer, the Windows scheduled task, TPM credentials, the keyring and DPAPI. The real TPM and DPAPI are exercised only in their spike, with the maintainer's permission, and undone afterwards.

The vault lives in `<GOOP_HOME>/data/` (`.temp/dev/home/data/` with `bun run dev`, `.local/data/` for a goop run straight through `scripts/dev-env/run.ts`). goop uses the OS key store only as the compiled executable without `GOOP_HOME`.

## The insecure development key

From source with `GOOP_HOME` in the repo's `.temp/dev/` (`bun run dev` sets `.temp/dev/home/`), a fake OS key store seals the data key instead: a random key kept in plain text in `.temp/dev/INSECURE-DEV-KEY` (0600, in a 0700 folder). The first `goop` still asks for a passphrase to set the vault up; after that every daemon start unlocks by itself and prints:

```text
goop daemon is using the insecure development key in .temp/dev/ (never use this for real data).
```

- Anyone who can read the file can open the vault: never put real data in a development vault.
- It never exists outside development: the compiled executable never uses it, whatever its environment, and no environment variable turns it on. From source with `GOOP_HOME` anywhere else (the tests' folders under `.temp/tests/`), the passphrase seals the data key as before.
- When `GOOP_HOME` is in `.temp/dev/` but the folder above `src/` is not the goop repository (its `package.json` is not named `goop`), the daemon refuses to start.
- `bun run clean` deletes it with the rest of `.temp/`, together with the development vault in `.temp/dev/home/`, so the next start sets a new vault up. Links are resolved first: a link inside `.temp/dev/` that points elsewhere does not count.
