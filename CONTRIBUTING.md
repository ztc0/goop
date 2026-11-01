# Contributing to goop

Thanks for your interest in goop. This guide covers how to set up the project and what a contribution needs.

## Setup

Requirements: [Bun](https://bun.sh) 1.3.14 or later and Git.

```sh
git clone https://github.com/ztc0/goop.git
cd goop
bun install
bun run test
```

Development stays inside the repository: persistent files go to `.local/` and disposable ones to `.temp/`. Nothing is written to your home directory. See [`docs/development/rules/local-env.md`](docs/development/rules/local-env.md).

## Before you open a pull request

1. Read [`AGENTS.md`](AGENTS.md) and the rule file for the area you touch.
2. Write the test first, see it fail, then make it pass.
3. Run `bun run lint`, `bun run typecheck` and `bun run test`; the pre-commit hook runs them too.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat(offers): add the Greenhouse connector`). commitlint checks every message.
5. Keep pull requests reviewable: about 400 changed lines, with tests and docs in the same change as the behavior.
6. Update the documentation and the changelog when behavior changes.

## Reporting bugs and ideas

Use the issue templates. For security problems, follow [`SECURITY.md`](SECURITY.md) instead of opening an issue.

## License

goop is licensed under GPL-3.0-only. By contributing, you agree that your contribution is licensed under the same terms.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
