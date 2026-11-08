import { describe, expect, test } from "bun:test";
import { ciState, findings, rabbitState } from "../../model/review-state";
import type { Check, RabbitComment, RabbitReview, ReviewComment } from "../../types";

const HEAD = "1862cb7aaaa";
const ASKED = "2026-11-08T22:49:56Z";

const check = (name: string, state: string): Check => ({ name, state });
const comment = (body: string, updatedAt: string, login = "coderabbitai[bot]"): RabbitComment => ({
  login,
  body,
  updatedAt,
});
const review = (body: string, commitId = HEAD, login = "coderabbitai[bot]"): RabbitReview => ({
  login,
  body,
  commitId,
});

describe("ciState (S3)", () => {
  test("is done with each job's state once nothing is pending", () => {
    const checks = [
      check("Lint, typecheck and test (ubuntu-latest)", "SUCCESS"),
      check("Lint, typecheck and test (windows-latest)", "FAILURE"),
    ];

    expect(ciState(checks)).toEqual({
      done: true,
      jobs: [
        { name: "Lint, typecheck and test (ubuntu-latest)", state: "SUCCESS" },
        { name: "Lint, typecheck and test (windows-latest)", state: "FAILURE" },
      ],
    });
  });

  test("keeps waiting while any check is in a nonterminal state", () => {
    for (const state of ["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "EXPECTED"]) {
      expect(ciState([check("ubuntu", "SUCCESS"), check("windows", state)]).done).toBe(false);
    }
  });

  test("ignores skipped checks and the CodeRabbit check", () => {
    const checks = [
      check("ubuntu", "SUCCESS"),
      check("Pull request to main comes from dev", "SKIPPED"),
      check("CodeRabbit", "PENDING"),
    ];

    expect(ciState(checks)).toEqual({ done: true, jobs: [{ name: "ubuntu", state: "SUCCESS" }] });
  });

  test("is not done while no check has started", () => {
    expect(ciState([]).done).toBe(false);
  });
});

describe("rabbitState (S4)", () => {
  test("is the rate limit when a CodeRabbit comment changed after the request says so", () => {
    const comments = [
      comment(
        "<summary>Action not completed</summary> Review rate limited.",
        "2026-11-08T22:50:11Z",
      ),
    ];

    expect(rabbitState({ head: HEAD, askedAt: ASKED, reviews: [], comments })).toBe("LIMIT");
  });

  test("ignores a rate-limit notice from before the request", () => {
    const comments = [comment("Review rate limited.", "2026-11-08T22:00:00Z")];

    expect(rabbitState({ head: HEAD, askedAt: ASKED, reviews: [], comments })).toBe("PENDING");
  });

  test("is reviewed by a CodeRabbit review of the head with a body", () => {
    const reviews = [review("**Actionable comments posted: 2**")];

    expect(rabbitState({ head: HEAD, askedAt: ASKED, reviews, comments: [] })).toBe("REVIEWED");
  });

  test("never counts a thread reply, an empty-bodied review, as the review", () => {
    const reviews = [review(""), review("   ")];

    expect(rabbitState({ head: HEAD, askedAt: ASKED, reviews, comments: [] })).toBe("PENDING");
  });

  test("never counts a review of another head or by someone else", () => {
    const reviews = [
      review("**Actionable comments posted: 1**", "0ld"),
      review("LGTM", HEAD, "ztc0"),
    ];

    expect(rabbitState({ head: HEAD, askedAt: ASKED, reviews, comments: [] })).toBe("PENDING");
  });

  test("is reviewed when CodeRabbit says the requested review finished", () => {
    const comments = [
      comment("<summary>Action performed</summary> Review finished.", "2026-11-08T22:51:00Z"),
    ];

    expect(rabbitState({ head: HEAD, askedAt: ASKED, reviews: [], comments })).toBe("REVIEWED");
  });

  test("keeps waiting while a review is in progress, even with an old one finished", () => {
    const comments = [comment("Review in progress", "2026-11-08T22:51:00Z")];
    const reviews = [review("**Actionable comments posted: 1**")];

    expect(rabbitState({ head: HEAD, askedAt: ASKED, reviews, comments })).toBe("PENDING");
  });
});

describe("findings (S5)", () => {
  const inline = (over: Partial<ReviewComment>): ReviewComment => ({
    id: 1,
    login: "coderabbitai[bot]",
    path: "a.md",
    line: 3,
    commitId: HEAD,
    inReplyTo: null,
    body: "**Minor** · **Functional Correctness** · **Quick win**\n\n**Bound the CI wait.**\n\nmore",
    ...over,
  });

  test("lists CodeRabbit's inline comments with their severity and title", () => {
    expect(findings(HEAD, [inline({})], [])).toEqual([
      { id: 1, where: "a.md:3", severity: "Minor", title: "Bound the CI wait." },
    ]);
  });

  test("reads the severity and title of a comment in CodeRabbit's real format", () => {
    const body = [
      "<!-- coderabbit-ai-generated:v1 -->",
      "",
      '**<picture><img src="https://storage.googleapis.com/x/amber-16.svg" width="16" alt=""></picture> Minor** · **Functional Correctness** · **Quick win**',
      "",
      "<details>",
      "<summary>Supported by static analysis</summary>",
      "Script executed: **not a title**",
      "</details>",
      "",
      "**Use a separate temporary file for each write.**",
      "",
      "On Linux, if two processes write the same target...",
    ].join("\n");

    expect(findings(HEAD, [inline({ body })], [])).toEqual([
      {
        id: 1,
        where: "a.md:3",
        severity: "Minor",
        title: "Use a separate temporary file for each write.",
      },
    ]);
  });

  test("skips replies and other people's comments", () => {
    const comments = [inline({ id: 2, inReplyTo: 1 }), inline({ id: 3, login: "ztc0" })];

    expect(findings(HEAD, comments, [])).toEqual([]);
  });

  test("adds the body of each CodeRabbit review of the head", () => {
    const reviews = [
      review("**Actionable comments posted: 0**\n\n<details>Nitpick: use a const</details>"),
    ];

    expect(findings(HEAD, [], reviews)).toEqual([
      {
        id: null,
        where: "review",
        severity: "Review",
        title: "**Actionable comments posted: 0**\n\n<details>Nitpick: use a const</details>",
      },
    ]);
  });
});
