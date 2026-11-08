# Release pull request and sync

## Open the release pull request

`main` only accepts pull requests from `dev`, and the maintainer squash-merges them by hand. The squash commit takes the pull request title, so the title is a Conventional Commit:

```bash
gh pr create --base main --head dev --title "feat: <what this release brings>" --body "<the changes since the last release>"
```

Never merge it.

## Sync dev after the squash

The squash writes one new commit on `main` that `dev` does not have. Left alone, the two branches diverge: the next release pull request shows old work again or conflicts.

When the maintainer says the release is in `main`:

```bash
git fetch origin
gh pr create --base dev --head main --title "chore: sync dev with main after <release>" --body "Brings the release squash commit from main into dev, as commits.md requires after each release."
```

Then the normal flow: wait for CI and CodeRabbit, report, and on the maintainer's word merge it with a merge commit, never a squash:

```bash
gh pr merge <n> --merge --match-head-commit <reviewed sha>
```

## When the sync conflicts

If `dev` changed a line the release squash also holds, the sync pull request conflicts and `gh pr merge` refuses it. Stop and report the conflicting files. On the maintainer's word, resolve it on a branch from `main`, never on `main` itself:

```bash
git switch -c sync/<release> origin/main
git merge origin/dev            # resolve the conflicts, then commit
git push -u origin sync/<release>
gh pr create --base dev --head sync/<release> --title "chore: sync dev with main after <release>"
```

That pull request replaces the conflicting one, which is closed.
