import { describe, expect, test } from "bun:test";
import { waitForReview } from "../../services/wait";
import type { Check, GhApi, RabbitComment, RabbitReview, ReviewComment } from "../../types";

const HEAD = "1862cb7aaaa";
const START = Date.parse("2026-11-08T22:00:00Z");
const RABBIT = "coderabbitai[bot]";
const SUCCESS: Check[] = [{ name: "ubuntu", state: "SUCCESS" }];
const RUNNING: Check[] = [{ name: "ubuntu", state: "IN_PROGRESS" }];

interface Script {
  heads?: string[];
  checks?: (Check[] | Error)[];
  reviews?: RabbitReview[][];
  comments?: RabbitComment[][];
  inline?: ReviewComment[];
}

/** A fake gh that answers each call from its script, repeating the last answer. */
function fakeGh(script: Script) {
  const calls: string[] = [];
  const next = <T>(list: T[] | undefined, fallback: T): T => {
    if (!list || list.length === 0) return fallback;
    return list.length > 1 ? (list.shift() as T) : (list[0] as T);
  };
  const gh: GhApi = {
    head: async () => next(script.heads, HEAD),
    requestReview: async () => {
      calls.push("requestReview");
    },
    checks: async () => {
      const answer = next(script.checks, SUCCESS);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    reviews: async () => next(script.reviews, []),
    comments: async () => next(script.comments, []),
    reviewComments: async () => script.inline ?? [],
  };
  return { gh, calls };
}

/** A clock that only moves when the service sleeps. */
function fakeClock() {
  let now = START;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

const after = (minutes: number) => new Date(START + minutes * 60_000 + 1).toISOString();

describe("waitForReview (S3, S4, S6)", () => {
  test("asks for the review, waits for CI and CodeRabbit, and reports the findings of the head", async () => {
    const { gh, calls } = fakeGh({
      checks: [RUNNING, RUNNING, SUCCESS],
      reviews: [[], [{ login: RABBIT, body: "**Actionable comments posted: 1**", commitId: HEAD }]],
      inline: [
        {
          id: 7,
          login: RABBIT,
          path: "a.md",
          line: 3,
          commitId: HEAD,
          inReplyTo: null,
          body: "**Minor** · x\n\n**Bound the wait.**",
        },
      ],
    });

    const report = await waitForReview(42, { gh, ...fakeClock() });

    expect(calls).toEqual(["requestReview"]);
    expect(report).toEqual({
      pr: 42,
      head: HEAD,
      ci: "DONE",
      jobs: SUCCESS,
      coderabbit: "REVIEWED",
      findings: [
        { id: 7, where: "a.md:3", severity: "Minor", title: "Bound the wait." },
        {
          id: null,
          where: "review",
          severity: "Review",
          title: "**Actionable comments posted: 1**",
        },
      ],
    });
  });

  test("reports the rate limit with no findings", async () => {
    const { gh } = fakeGh({
      comments: [[{ login: RABBIT, body: "Review rate limited.", updatedAt: after(1) }]],
    });

    const report = await waitForReview(42, { gh, ...fakeClock() });

    expect(report.coderabbit).toBe("LIMIT");
    expect(report.findings).toEqual([]);
  });

  test("stops when the head moves: the review would be of old code", async () => {
    const { gh } = fakeGh({ heads: [HEAD, HEAD, "f00d"] });

    const report = await waitForReview(42, { gh, ...fakeClock() });

    expect(report.coderabbit).toBe("HEAD_MOVED");
  });

  test("ends CI as unavailable after five failed gh calls in a row", async () => {
    const failure = new Error("gh: network");
    const { gh } = fakeGh({ checks: [failure, failure, failure, failure, failure] });

    const report = await waitForReview(42, { gh, ...fakeClock() });

    expect(report.ci).toBe("UNAVAILABLE");
  });

  test("a gh call that recovers before five failures keeps waiting", async () => {
    const failure = new Error("gh: network");
    const { gh } = fakeGh({ checks: [failure, failure, failure, failure, SUCCESS] });

    const report = await waitForReview(42, { gh, ...fakeClock() });

    expect(report.ci).toBe("DONE");
  });

  test("ends CI after an hour and CodeRabbit after 45 minutes as timeouts", async () => {
    const { gh } = fakeGh({ checks: [RUNNING] });

    const report = await waitForReview(42, { gh, ...fakeClock() });

    expect(report.ci).toBe("TIMEOUT");
    expect(report.jobs).toEqual(RUNNING);
    expect(report.coderabbit).toBe("TIMEOUT");
  });
});
