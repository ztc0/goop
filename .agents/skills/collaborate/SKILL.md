---

name: collaborate
description: "Trigger: commit, commitear, open a PR, abrir PR, pull request, stacked PRs, cadena de PRs, CodeRabbit, review, merge to dev, mergear, release, sync main, ya mergeé a main. Commit, open and review pull requests, merge into dev and sync dev after a release, the goop way."
license: GPL-3.0-only
metadata: { author: ztc0, version: "1.0" }
---

## Activation Contract

Use when committing, opening or updating a pull request, handling CodeRabbit, merging into `dev`, opening the `dev` -> `main` pull request, or syncing `dev` after the maintainer merged a release into `main`.
This skill is the procedure; the rules live in `docs/development/rules/commits.md`. When they disagree, `commits.md` wins.

## Hard Rules

- Never merge into `main`, push to it, tag or release.
- Never force-push. When history must be rewritten, give the maintainer the exact `--force-with-lease=<branch>:<old sha>` commands.
- Never `--no-verify`: a failing hook is a failing change.
- Never merge, and never fix CodeRabbit findings, before the maintainer decides.
- Run a command that reads a file only after the write that creates it has finished.
- Scratch files go to `.temp/scratch/`.

## Decision Gates

| Situation                                  | Do                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------- |
| A change of about 400 lines or less        | One branch from `dev`, one pull request                              |
| Related changes (a rule and what uses it)  | One pull request, one commit each                                    |
| More than about 400 lines                  | A stacked chain: `references/stacked-chain.md`                       |
| A fix to an early pull request of a chain  | Check it at the chain's tip first: `references/stacked-chain.md`     |
| A red CI job                               | Read its log; fix what the pull request caused; rerun a timeout once |
| CodeRabbit hit its rate limit              | Report it; merge only if the maintainer still decides to             |
| The head moved after the report            | Back to step 4: a new review and a new decision                      |
| The maintainer says the release is in main | `references/release-sync.md`                                         |

## Execution Steps

1. Branch from a fresh `origin/dev`: `feat/`, `fix/` or `docs/`.
2. Commit work units: `type(scope): subject`, with their tests and docs.
3. Until the maintainer asks for the pull request, stop here and report the branch and its commits. When the last task of the feature document (or of a part the maintainer agreed to ship alone) has its commit, or the maintainer says work without a feature document is done, propose the pull request once (`commits.md`, Publishing): the branch, its commits, its changed lines over `dev` and whether it becomes a chain, as one yes or no question. On yes, or when asked: push and open it into `dev` with the sections of `.github/PULL_REQUEST_TEMPLATE.md`; tick only what is true and say why for the rest.
4. In the background, run `bun scripts/dev-env/run.ts bun .agents/skills/collaborate/scripts/review.ts <n>`: it asks CodeRabbit to review the head and waits for CI and CodeRabbit (`references/waiting.md`).
5. Report and stop: the head SHA reviewed, CI per job, each finding with whether it is valid and why (or the rate limit), and a proposal: merge, fix, or reject with a reason.
6. Do what the maintainer decides: fix on the branch and push (then back to step 4), reply on rejected findings with the reason, or merge exactly the reviewed head: `gh pr merge <n> --merge --match-head-commit <reviewed sha>`.

## Output Contract

Pull request numbers and URLs, CI state per job, CodeRabbit findings with a verdict each, and what waits for the maintainer.

## References

- `docs/development/rules/commits.md`: the rules this procedure follows.
- `references/waiting.md`: the review script, its report, and reading findings.
- `references/stacked-chain.md`: building, fixing and merging a chain.
- `references/release-sync.md`: the `dev` -> `main` pull request and the sync after it.
