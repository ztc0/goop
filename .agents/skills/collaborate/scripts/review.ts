// Asks CodeRabbit to review a pull request's head, waits for CI and CodeRabbit, and prints the
// report the maintainer decides on, as JSON (see ../references/waiting.md).
// Usage: bun scripts/dev-env/run.ts bun .agents/skills/collaborate/scripts/review.ts <pull request number>
import { ghApi, spawnGh } from "./adapters/gh";
import { waitForReview } from "./services/wait";

const USAGE =
  "Usage: bun scripts/dev-env/run.ts bun .agents/skills/collaborate/scripts/review.ts <pull request number>\n";

const args = process.argv.slice(2);
const pr = args.length === 1 && /^[1-9]\d*$/.test(args[0] ?? "") ? Number(args[0]) : null;
if (pr === null) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const report = await waitForReview(pr, {
  gh: ghApi(spawnGh),
  now: () => Date.now(),
  sleep: (ms) => Bun.sleep(ms),
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
