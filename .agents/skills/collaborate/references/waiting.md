# Waiting for CI and CodeRabbit

One command asks CodeRabbit to review the pull request's current head, waits for CI and for CodeRabbit, and prints the report as JSON. Run it in the background and react to its exit; never poll by hand.

```bash
bun scripts/dev-env/run.ts bun .agents/skills/collaborate/scripts/review.ts <n>
```

## The report

| Field        | Values                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `head`       | The SHA the review and the maintainer's decision are for; merge with `--match-head-commit <head>`                              |
| `ci`         | `DONE` (see `jobs` for each state), `UNAVAILABLE` (5 failed `gh` calls in a row) or `TIMEOUT` (one hour)                       |
| `jobs`       | Each check that counts, with its state; skipped checks and CodeRabbit's are left out                                           |
| `coderabbit` | `REVIEWED`, `LIMIT` (rate limited), `HEAD_MOVED` (a push during the wait: start over), `UNAVAILABLE` or `TIMEOUT` (45 minutes) |
| `findings`   | CodeRabbit's inline findings (`id`, `where`, `severity`, `title`) and the bodies of its reviews of the head (`id` is null)     |

A review counts only for the head: a thread reply creates an empty-bodied review, which never counts.

## A red job

Start with the failing lines; when they do not show the cause, read the whole failed log:

```bash
gh run view --job <job id> --log-failed | grep -E "\(fail\)|error:|Expected|Received"
gh run view --job <job id> --log-failed
```

A test that hit its 5 s timeout on one runner (for example commitlint on Windows) is flaky: `gh run rerun <run id> --failed` once, and say so in the report.

## Reading a finding

The report lists titles; read each finding whole before judging it, `<details>` blocks included: they hold the proposed patches and test cases.

```bash
gh api repos/{owner}/{repo}/pulls/comments/<id> -q .body
```

CodeRabbit's pull request comments (`gh api repos/{owner}/{repo}/issues/<n>/comments`) hold its walkthrough and any review it could not attach to a line. Reply in a finding's thread:

```bash
gh api repos/{owner}/{repo}/pulls/<n>/comments/<id>/replies -f body="..."
```
