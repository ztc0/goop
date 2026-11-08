import type {
  Check,
  CiState,
  Finding,
  RabbitComment,
  RabbitInput,
  RabbitResult,
  RabbitReview,
  ReviewComment,
} from "../types";

const NONTERMINAL = new Set([
  "PENDING",
  "QUEUED",
  "IN_PROGRESS",
  "WAITING",
  "REQUESTED",
  "EXPECTED",
]);
const LIMIT = /rate limit|limit exceeded|reached .*limit/i;
const IN_PROGRESS = /review in progress|currently processing/i;
const FINISHED = /review finished/i;

const isRabbit = (login: string) => /coderabbit/i.test(login);

/** CI is done once every check that counts reached a terminal state (S3). */
export function ciState(checks: Check[]): CiState {
  const jobs = checks
    .filter((check) => check.state !== "SKIPPED" && !/coderabbit/i.test(check.name))
    .map(({ name, state }) => ({ name, state }));
  return { done: jobs.length > 0 && jobs.every((job) => !NONTERMINAL.has(job.state)), jobs };
}

/**
 * Where CodeRabbit is with the review asked for `head` at `askedAt` (S4). Only what CodeRabbit
 * said after the request counts; an empty-bodied review is a thread reply, never the review.
 */
export function rabbitState({ head, askedAt, reviews, comments }: RabbitInput): RabbitResult {
  const since = Date.parse(askedAt);
  const recent = comments.filter(
    (comment: RabbitComment) => isRabbit(comment.login) && Date.parse(comment.updatedAt) > since,
  );
  if (recent.some((comment) => LIMIT.test(comment.body))) return "LIMIT";
  if (recent.some((comment) => IN_PROGRESS.test(comment.body))) return "PENDING";
  if (recent.some((comment) => FINISHED.test(comment.body))) return "REVIEWED";
  return headReviews(head, reviews).length > 0 ? "REVIEWED" : "PENDING";
}

/** CodeRabbit's inline findings and the bodies of its reviews of `head` (S5). */
export function findings(
  head: string,
  comments: ReviewComment[],
  reviews: RabbitReview[],
): Finding[] {
  const inline = comments
    .filter((comment) => isRabbit(comment.login) && comment.inReplyTo === null)
    .map((comment) => ({
      id: comment.id,
      where: comment.line === null ? comment.path : `${comment.path}:${comment.line}`,
      severity:
        /\*\*([^*]+)\*\*/
          .exec(comment.body)?.[1]
          ?.replace(/<[^>]*>/g, "")
          .trim() || "Unknown",
      title:
        /^\*\*([^*]+)\*\*\s*$/m.exec(comment.body.split("\n").slice(1).join("\n"))?.[1]?.trim() ??
        "",
    }));
  const bodies = headReviews(head, reviews).map((review) => ({
    id: null,
    where: "review",
    severity: "Review",
    title: review.body.trim(),
  }));
  return [...inline, ...bodies];
}

function headReviews(head: string, reviews: RabbitReview[]): RabbitReview[] {
  return reviews.filter(
    (review) => isRabbit(review.login) && review.commitId === head && review.body.trim() !== "",
  );
}
