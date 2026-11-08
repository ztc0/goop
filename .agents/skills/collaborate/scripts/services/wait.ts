import { ciState, findings, rabbitState } from "../model/review-state";
import type { Check, CiResult, RabbitOutcome, Report, WaitDeps } from "../types";

const CI_DEADLINE_MS = 60 * 60_000;
const CI_POLL_MS = 15_000;
const RABBIT_DEADLINE_MS = 45 * 60_000;
const RABBIT_POLL_MS = 30_000;
/** gh calls that fail in a row before a wait gives up as unavailable. */
const MAX_FAILURES = 5;

/**
 * Asks CodeRabbit to review the pull request's current head, then waits for CI and for
 * CodeRabbit, each with its own deadline, and returns what the maintainer decides on (S3-S6).
 */
export async function waitForReview(pr: number, deps: WaitDeps): Promise<Report> {
  const { gh } = deps;
  const head = await gh.head(pr);
  const askedAt = new Date(deps.now()).toISOString();
  await gh.requestReview(pr);

  const ci = await waitForCi(pr, deps);
  const coderabbit = await waitForRabbit(pr, head, askedAt, deps);
  const found =
    coderabbit === "REVIEWED"
      ? findings(head, await gh.reviewComments(pr), await gh.reviews(pr))
      : [];
  return { pr, head, ci: ci.result, jobs: ci.jobs, coderabbit, findings: found };
}

async function waitForCi(pr: number, deps: WaitDeps): Promise<{ result: CiResult; jobs: Check[] }> {
  const deadline = deps.now() + CI_DEADLINE_MS;
  let failures = 0;
  let jobs: Check[] = [];
  for (;;) {
    try {
      const state = ciState(await deps.gh.checks(pr));
      failures = 0;
      jobs = state.jobs;
      if (state.done) return { result: "DONE", jobs };
    } catch {
      if (++failures >= MAX_FAILURES) return { result: "UNAVAILABLE", jobs };
    }
    if (deps.now() >= deadline) return { result: "TIMEOUT", jobs };
    await deps.sleep(CI_POLL_MS);
  }
}

async function waitForRabbit(
  pr: number,
  head: string,
  askedAt: string,
  deps: WaitDeps,
): Promise<RabbitOutcome> {
  const deadline = Date.parse(askedAt) + RABBIT_DEADLINE_MS;
  let failures = 0;
  for (;;) {
    try {
      if ((await deps.gh.head(pr)) !== head) return "HEAD_MOVED";
      const state = rabbitState({
        head,
        askedAt,
        reviews: await deps.gh.reviews(pr),
        comments: await deps.gh.comments(pr),
      });
      failures = 0;
      if (state !== "PENDING") return state;
    } catch {
      if (++failures >= MAX_FAILURES) return "UNAVAILABLE";
    }
    if (deps.now() >= deadline) return "TIMEOUT";
    await deps.sleep(RABBIT_POLL_MS);
  }
}
