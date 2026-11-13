# Changelog

All notable changes to goop are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Repository foundation: Bun and strict TypeScript with the `@/` alias, Biome, Husky with Conventional Commits.
- Repo-local development environment: `.local/` for persistent files and `.temp/` for disposable ones, with `clean` and `clean:local` scripts.
- `AGENTS.md` with progressive-disclosure rule files for contributors and coding agents.
- Licensing (GPL-3.0-only), security policy, code of conduct and contributing guide.
- Pinned native libraries: goop loads its encrypted SQLite library (sqlite3mc) only after checking its sha256 against the build's manifest; `bun run build` embeds the library, and goop extracts it to a private `lib/native/` folder. CI builds, checks and attests the libraries and runs the tests against them on Linux and Windows.
- `goop` and `goop daemon`: one executable with two modes that talk JSON-RPC 2.0 over a socket only the same user can open (Linux). The daemon owns the encrypted vault and waits locked until `goop` unlocks it; the passphrase is typed without echo and never reaches a log. Windows support follows.
- `bun run dev`: goop from source in a light container (`goop-dev`, Podman or Docker) whose daemon restarts on every source change, with `bun run dev:logs` and `bun run dev:stop`; its data stays in `.temp/dev/`. From source there, an insecure development key unlocks the vault by itself; the compiled executable never uses it.

### Security

- The compiled executable no longer loads a `.env` or `bunfig.toml` from the folder it starts in, so that folder cannot change goop's settings or run code before it.
