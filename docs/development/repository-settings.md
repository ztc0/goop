# GitHub repository settings

These settings protect the public repository. They were applied on 2026-11-01, right after the first publication of `ztc0/goop`.

## How a change reaches `main`

```mermaid
flowchart LR
    Branch[Feature branch] --> PR[Pull request]
    PR --> CI{CI green on<br/>Linux and Windows}
    CI -->|no| Fix[Fix and push again] --> CI
    CI -->|yes| Review{Resolved review<br/>threads}
    Review -->|changes requested| Fix
    Review -->|approved| Merge[Squash or rebase merge<br/>into main]
```

## Ruleset for `main`

| Setting                               | Value                                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Require a pull request before merging | On, 0 required approvals (a sole maintainer cannot approve their own pull requests), dismiss stale approvals on new commits; raise to 1 when a second maintainer joins |
| Require status checks                 | `Lint, typecheck and test (ubuntu-latest)` and `Lint, typecheck and test (windows-latest)`, branch up to date                                                          |
| Require conversation resolution       | On                                                                                                                                                                     |
| Require linear history                | On (squash or rebase merges only)                                                                                                                                      |
| Block force pushes                    | On                                                                                                                                                                     |
| Restrict deletions                    | On                                                                                                                                                                     |
| Bypass list                           | Empty, including administrators                                                                                                                                        |

## Security

| Setting                                | Value                                                   |
| -------------------------------------- | ------------------------------------------------------- |
| Private vulnerability reporting        | On (used by `SECURITY.md`)                              |
| Secret scanning and push protection    | On                                                      |
| Dependabot alerts and security updates | On (version updates come from `.github/dependabot.yml`) |
| Code scanning                          | CodeQL default setup                                    |

## Actions

| Setting                                          | Value                                          |
| ------------------------------------------------ | ---------------------------------------------- |
| Default `GITHUB_TOKEN` permissions               | Read repository contents only                  |
| Fork pull request workflows                      | Require approval for all outside collaborators |
| Allow Actions to create or approve pull requests | Off                                            |

## General

| Setting                            | Value                                   |
| ---------------------------------- | --------------------------------------- |
| Visibility                         | Public                                  |
| Default branch                     | `main`                                  |
| Merge buttons                      | Squash and rebase on, merge commits off |
| Automatically delete head branches | On                                      |
| Wiki and projects                  | Off (docs live in `docs/`)              |

## Keeping them in sync

The settings were applied with the GitHub CLI (`gh repo edit`, and `gh api` for the "Protect main" ruleset and the security features). Re-check this file whenever the CI job names change, because the required status checks refer to them by name.
