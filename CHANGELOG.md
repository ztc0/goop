# Changelog

All notable changes to goop are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Repository foundation: Bun and strict TypeScript with the `@/` alias, Biome, Husky with Conventional Commits.
- Repo-local development environment: `.local/` for persistent files and `.temp/` for disposable ones, with `clean` and `clean:local` scripts.
- `AGENTS.md` with progressive-disclosure rule files for contributors and coding agents.
- Licensing (GPL-3.0-only), security policy, code of conduct and contributing guide.
- Pinned native libraries: goop loads its encrypted SQLite library (sqlite3mc) only after checking its sha256 against the build's manifest; `bun run build` embeds the library, and goop extracts it to a private `lib/native/` folder. CI builds, checks and attests the libraries and runs the tests against them on Linux and Windows.
