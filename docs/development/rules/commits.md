# Commit and review rules

## Messages

Conventional Commits, checked by commitlint in the `commit-msg` hook:

```text
type(scope): subject in the imperative
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`. The scope is the feature folder when there is one (`feat(offers): add the Greenhouse connector`).

## Hooks

`pre-commit` runs Biome on staged files, the typecheck and the test suite. Do not bypass hooks with `--no-verify`.

## Work units

- Work on a feature branch, never directly on `main`.
- Commit in reviewable slices of about 400 authored changed lines; tests and docs go in the same commit as the behavior they cover.
- A change that touches security, stored data or delivery gets its own commit.
- Record the commit of each task in the plan (`odd/tasks/goop.md`).

## Merging

Every pull request lands on `main` as **one squashed commit**. Its message is the pull request title, so the title must be a Conventional Commit (`feat(offers): add the Greenhouse connector`). Rebase and merge commits are disabled in the repository.

## Publishing

No push, no remote, no pull request and no release without the maintainer's explicit approval.
