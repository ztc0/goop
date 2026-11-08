import { describe, expect, test } from "bun:test";
import { type GhRunner, ghApi } from "../../adapters/gh";

/** A fake gh: records each call's arguments and answers with the given exit code and stdout. */
function fakeRunner(answer: (args: string[]) => { exitCode: number; stdout: string }) {
  const calls: string[][] = [];
  const run: GhRunner = async (args) => {
    calls.push(args);
    return answer(args);
  };
  return { run, calls };
}

const ok = (value: unknown) => ({ exitCode: 0, stdout: JSON.stringify(value) });

describe("ghApi", () => {
  test("reads the head SHA of the pull request", async () => {
    const { run, calls } = fakeRunner(() => ({ exitCode: 0, stdout: "1862cb7\n" }));

    expect(await ghApi(run).head(77)).toBe("1862cb7");
    expect(calls).toEqual([["pr", "view", "77", "--json", "headRefOid", "-q", ".headRefOid"]]);
  });

  test("asks CodeRabbit for a review with a pull request comment", async () => {
    const { run, calls } = fakeRunner(() => ({ exitCode: 0, stdout: "" }));

    await ghApi(run).requestReview(77);

    expect(calls).toEqual([["pr", "comment", "77", "--body", "@coderabbitai review"]]);
  });

  test("reads the checks even when gh exits 8 (pending) or 1 (failed)", async () => {
    for (const exitCode of [0, 1, 8]) {
      const { run } = fakeRunner(() => ({
        exitCode,
        stdout: '[{"name":"ubuntu","state":"PENDING"}]',
      }));

      expect(await ghApi(run).checks(77)).toEqual([{ name: "ubuntu", state: "PENDING" }]);
    }
  });

  test("fails when a call fails without JSON, so the wait counts it", async () => {
    const { run } = fakeRunner(() => ({ exitCode: 1, stdout: "" }));

    await expect(ghApi(run).checks(77)).rejects.toThrow("gh pr checks 77 failed (exit 1)");
    await expect(ghApi(run).head(77)).rejects.toThrow("gh pr view 77 failed (exit 1)");
  });

  test("reads every page of reviews, comments and inline comments", async () => {
    const { run, calls } = fakeRunner((args) => {
      const path = args[1] ?? "";
      if (path.endsWith("/reviews")) {
        return ok([[{ user: { login: "coderabbitai[bot]" }, body: "b", commit_id: "h" }], []]);
      }
      if (path.includes("/issues/")) {
        return ok([[{ user: { login: "coderabbitai[bot]" }, body: "c", updated_at: "t" }]]);
      }
      return ok([
        [
          {
            id: 1,
            user: { login: "coderabbitai[bot]" },
            path: "a.md",
            line: null,
            original_line: 3,
            commit_id: "h",
            body: "x",
          },
        ],
        [
          {
            id: 2,
            user: { login: "ztc0" },
            path: "a.md",
            line: 4,
            commit_id: "h",
            in_reply_to_id: 1,
            body: "y",
          },
        ],
      ]);
    });
    const gh = ghApi(run);

    expect(await gh.reviews(77)).toEqual([
      { login: "coderabbitai[bot]", body: "b", commitId: "h" },
    ]);
    expect(await gh.comments(77)).toEqual([
      { login: "coderabbitai[bot]", body: "c", updatedAt: "t" },
    ]);
    expect(await gh.reviewComments(77)).toEqual([
      {
        id: 1,
        login: "coderabbitai[bot]",
        path: "a.md",
        line: 3,
        commitId: "h",
        inReplyTo: null,
        body: "x",
      },
      { id: 2, login: "ztc0", path: "a.md", line: 4, commitId: "h", inReplyTo: 1, body: "y" },
    ]);
    expect(calls).toEqual([
      ["api", "repos/{owner}/{repo}/pulls/77/reviews", "--paginate", "--slurp"],
      ["api", "repos/{owner}/{repo}/issues/77/comments", "--paginate", "--slurp"],
      ["api", "repos/{owner}/{repo}/pulls/77/comments", "--paginate", "--slurp"],
    ]);
  });
});
