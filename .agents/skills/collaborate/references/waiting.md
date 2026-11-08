# Waiting for CI and CodeRabbit

Run each wait in the background and react to its exit; never poll by hand. `<n>` is the pull request number. Every wait has a deadline: past it, report the state as unavailable instead of waiting forever.

## CI

Done when no check is in a nonterminal state. The CodeRabbit check is not CI; skipped checks do not count. A `gh` call that keeps failing ends the wait as unavailable.

```bash
deadline=$(( $(date +%s) + 3600 )); failures=0
while :; do
  if s=$(gh pr checks <n> --json name,state \
      -q '[.[] | select(.state!="SKIPPED" and (.name|test("CodeRabbit")|not)) | .state] | unique | join(",")'); then
    failures=0
    [ -n "$s" ] && ! echo "$s" | grep -qE "PENDING|QUEUED|IN_PROGRESS|WAITING|REQUESTED|EXPECTED" && break
  elif [ $(( failures += 1 )) -ge 5 ]; then s=UNAVAILABLE; break; fi
  [ "$(date +%s)" -gt "$deadline" ] && { s=TIMEOUT; break; }
  sleep 15
done
echo "CI: $s"   # SUCCESS, a list holding FAILURE, UNAVAILABLE or TIMEOUT
```

For a failure, start with the failing lines; when they do not show the cause, read the whole failed log:

```bash
gh run view --job <job id> --log-failed | grep -E "\(fail\)|error:|Expected|Received"
gh run view --job <job id> --log-failed
```

A test that hit its 5 s timeout on one runner (for example commitlint on Windows) is flaky: `gh run rerun <run id> --failed` once, and say so in the report.

## CodeRabbit

A result counts only for the current head. Note it before asking for the review:

```bash
head=$(gh pr view <n> --json headRefOid -q .headRefOid)
gh pr comment <n> --body "@coderabbitai review"
```

CodeRabbit is done when one of these holds:

| State    | How to tell                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| Limit    | A CodeRabbit comment posted after the request matches `rate limit`, `limit exceeded` or `reached .* limit` |
| Reviewed | `gh api repos/ztc0/goop/pulls/<n>/reviews` has a CodeRabbit review whose `commit_id` is `$head`            |

While a CodeRabbit comment says `review in progress` or `currently processing`, keep waiting. Give up after about 45 minutes and report the timeout. If the head moves while waiting, the review is for old code: start over.

## Reading the findings

Findings live in three places; read all of them before reporting:
- Inline comments: `gh api repos/ztc0/goop/pulls/<n>/comments` (CodeRabbit's, without `in_reply_to_id`).
- The review body of that review: outside-diff-range comments and nitpicks.
- CodeRabbit's pull request comments: `gh api repos/ztc0/goop/issues/<n>/comments`.

Read each finding whole, `<details>` blocks included: they hold the proposed patches and test cases. The report to the maintainer is a summary; the patches inform the fix. Reply in a finding's thread: `gh api repos/ztc0/goop/pulls/<n>/comments/<id>/replies -f body="..."`.
