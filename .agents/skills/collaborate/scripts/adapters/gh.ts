import type { Check, GhApi, RabbitComment, RabbitReview, ReviewComment } from "../types";

/** Runs `gh` with the given arguments; the real one spawns it, tests fake it. */
export type GhRunner = (args: string[]) => Promise<{ exitCode: number; stdout: string }>;

/** The real `gh`, without a shell, in the current directory's repository. */
export const spawnGh: GhRunner = async (args) => {
  const child = Bun.spawn(["gh", ...args], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(child.stdout).text();
  return { exitCode: await child.exited, stdout };
};

interface ApiUser {
  login: string;
}

export function ghApi(run: GhRunner): GhApi {
  const text = async (label: string, args: string[]) => {
    const result = await run(args);
    if (result.exitCode !== 0) throw new Error(`gh ${label} failed (exit ${result.exitCode})`);
    return result.stdout.trim();
  };
  /** Every page of a list endpoint: `--slurp` wraps the pages in one array. */
  const pages = async <T>(path: string): Promise<T[]> => {
    const body = await text(`api ${path}`, [
      "api",
      `repos/{owner}/{repo}/${path}`,
      "--paginate",
      "--slurp",
    ]);
    return (JSON.parse(body) as T[][]).flat();
  };

  return {
    head: (pr) =>
      text(`pr view ${pr}`, [
        "pr",
        "view",
        String(pr),
        "--json",
        "headRefOid",
        "-q",
        ".headRefOid",
      ]),

    requestReview: async (pr) => {
      await text(`pr comment ${pr}`, [
        "pr",
        "comment",
        String(pr),
        "--body",
        "@coderabbitai review",
      ]);
    },

    // gh pr checks exits 8 while checks are pending and 1 when one failed; the JSON is the answer.
    checks: async (pr) => {
      const result = await run(["pr", "checks", String(pr), "--json", "name,state"]);
      try {
        return JSON.parse(result.stdout) as Check[];
      } catch {
        throw new Error(`gh pr checks ${pr} failed (exit ${result.exitCode})`);
      }
    },

    reviews: async (pr) =>
      (await pages<{ user: ApiUser; body: string; commit_id: string }>(`pulls/${pr}/reviews`)).map(
        (review): RabbitReview => ({
          login: review.user.login,
          body: review.body,
          commitId: review.commit_id,
        }),
      ),

    comments: async (pr) =>
      (
        await pages<{ user: ApiUser; body: string; updated_at: string }>(`issues/${pr}/comments`)
      ).map(
        (comment): RabbitComment => ({
          login: comment.user.login,
          body: comment.body,
          updatedAt: comment.updated_at,
        }),
      ),

    reviewComments: async (pr) =>
      (
        await pages<{
          id: number;
          user: ApiUser;
          path: string;
          line: number | null;
          original_line?: number | null;
          commit_id: string;
          in_reply_to_id?: number;
          body: string;
        }>(`pulls/${pr}/comments`)
      ).map(
        (comment): ReviewComment => ({
          id: comment.id,
          login: comment.user.login,
          path: comment.path,
          line: comment.line ?? comment.original_line ?? null,
          commitId: comment.commit_id,
          inReplyTo: comment.in_reply_to_id ?? null,
          body: comment.body,
        }),
      ),
  };
}
