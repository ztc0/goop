/** One check of a pull request, as `gh pr checks --json name,state` lists it. */
export interface Check {
  name: string;
  state: string;
}

export interface CiState {
  /** No check is in a nonterminal state any more. */
  done: boolean;
  /** The checks that count: not skipped, not CodeRabbit's. */
  jobs: Check[];
}

/** A pull request (issue) comment. */
export interface RabbitComment {
  login: string;
  body: string;
  /** ISO 8601; CodeRabbit edits its comments in place, so this is when it last spoke. */
  updatedAt: string;
}

/** A pull request review. A thread reply creates one with an empty body. */
export interface RabbitReview {
  login: string;
  body: string;
  commitId: string;
}

/** An inline review comment. */
export interface ReviewComment {
  id: number;
  login: string;
  path: string;
  line: number | null;
  commitId: string;
  inReplyTo: number | null;
  body: string;
}

export type RabbitResult = "PENDING" | "LIMIT" | "REVIEWED";

export interface RabbitInput {
  head: string;
  /** When the review was requested, ISO 8601. */
  askedAt: string;
  reviews: RabbitReview[];
  comments: RabbitComment[];
}

export interface Finding {
  /** The inline comment's id, to reply in its thread; null for a review body. */
  id: number | null;
  where: string;
  severity: string;
  title: string;
}
