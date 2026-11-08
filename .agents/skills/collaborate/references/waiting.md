# Waiting for CI and CodeRabbit

Run each wait in the background and react to its exit; never poll by hand. `<n>` is the pull request number.

## CI

Done when no check is pending. The CodeRabbit check is not CI; skipped checks do not count.

```bash
until s=$(gh pr checks <n> --json name,state \
    -q '[.[] | select(.state!="SKIPPED" and (.name|test("CodeRabbit")|not)) | .state] | unique | join(",")') \
  && [ -n "$s" ] && ! echo "$s" | grep -qE "PENDING|QUEUED|IN_PROGRESS"; do sleep 15; done
echo "CI: $s"   # SUCCESS, or a list holding FAILURE
```

For a failure, read only the failing lines:

```bash
gh run view --job <job id> --log-failed | grep -E "\(fail\)|error:|Expected|Received"
```

A test that hit its 5 s timeout on one runner (for example commitlint on Windows) is flaky: `gh run rerun <run id> --failed` once, and say so in the report.

## CodeRabbit

After `gh pr comment <n> --body "@coderabbitai review"`, CodeRabbit is done when one of these holds:

| State    | How to tell                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| Limit    | A CodeRabbit comment matches `rate limit`, `limit exceeded` or `reached .* limit`                                    |
| Findings | `gh api repos/ztc0/goop/pulls/<n>/reviews` has a CodeRabbit review, and its inline comments without `in_reply_to_id` |
| Clean    | A CodeRabbit review with no inline comments, or a comment saying `no actionable comments`                            |

While a CodeRabbit comment says `review in progress` or `currently processing`, keep waiting. Give up after about 45 minutes and report the timeout.

Read a finding without its HTML scaffolding: `gh api repos/ztc0/goop/pulls/comments/<id> -q .body`, then drop the `<details>` blocks. Reply in its thread: `gh api repos/ztc0/goop/pulls/<n>/comments/<id>/replies -f body="..."`.
