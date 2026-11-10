# collaborate scripts

The `collaborate` skill's waits become tested TypeScript scripts run with Bun, inside the skill: they are tools for agents, not developer scripts. Branch `feat/collaborate-scripts` from `dev` `a53fd6a`.

## Specs

- S1: "esto esta mal scripts/review/ por esto es para los dev y la skill es para los agentes y esa scripts es para los agents": the scripts live in `.agents/skills/collaborate/scripts/`, TypeScript on Bun (the repo's pinned runtime), run through `scripts/dev-env/run.ts`.
- S2: The checks cover them: `bun run test` runs the tests under `.agents/` (Bun skips dot folders unless given `./.agents`), `bun run typecheck` includes `.agents`.
- S3: CI wait: done when no check is `PENDING`, `QUEUED`, `IN_PROGRESS`, `WAITING`, `REQUESTED` or `EXPECTED`; `SKIPPED` checks and the CodeRabbit check do not count; 5 failed `gh` calls in a row end it as `UNAVAILABLE`; past its deadline it is `TIMEOUT`.
- S4: CodeRabbit wait: the request records the head SHA and the time; only results for that head count. `LIMIT`: a CodeRabbit comment changed after the request says "rate limited" (or "rate limit", "limit exceeded"). `REVIEWED`: a CodeRabbit review for the head with a non-empty body, or a CodeRabbit comment changed after the request saying "Review finished". A review with an empty body is a thread reply and never counts. While "review in progress" or "currently processing" shows, keep waiting. A moved head is `HEAD_MOVED`; past 45 minutes, `TIMEOUT`.
- S5: Findings: CodeRabbit's inline comments that are not replies and the bodies of its reviews for the head; each with id, file and line, severity and title.
- S6: The report: head SHA, CI per job, CodeRabbit state, findings. The skill's `waiting.md` and step 4 run the script instead of hand-written loops.

## Tasks

- [x] T1 (S3, S4, S5): pure model with unit tests, test-first. Route: inline. Commit `1e5556b` (also the `package.json` test script and `tsconfig.json`, S2): suite 440 -> 455 tests, RED seen on the missing module and on CodeRabbit's real comment format (HTML in the severity).
- [x] T2 (S1, S2, S6): `gh` adapter, wait service with injected clock, CLI, skill docs. Route: inline. Commit `4ffe892` (588 lines, 287 tests): suite at 469; each module RED on its missing file first.
- [x] T3: #78 (T1, into `dev`) and #79 (T2, on #78); first real `review.ts` run on both. Two stacked pull requests (T1 is 316 lines; T1 + T2 pass the 400-line budget), CodeRabbit, report to the maintainer. Route: inline. Evidence: #78 and #79 merged into `dev` on 2026-11-08 (CodeRabbit rate limited, maintainer decided to merge).

## Log

- L1: "la scripts de collaborate puede ser javescripts y que use node js para ejecutarlo eso puede colocarlo en la skill que me dice"; then "esto esta mal scripts/review/ por esto es para los dev y la skill es para los agentes y esa scripts es para los agents. y soluciona los confitos como me digiste"; then "dale".
- L3: First real runs (S6): `review.ts 78` and `review.ts 79` both exited 0 in 35 s: `ci: DONE` with the 3 jobs `SUCCESS`, `coderabbit: LIMIT`, no findings, heads `1e5556b` and `4ffe892`. The limit is real: CodeRabbit's comment on #78 (22:58:30Z) says "Review rate limited", next to its "Review limit reached" warning.
- L2: Evidence: `bun test` skips `.agents/` (440 tests, 45 files with a probe there); `bun test ./ ./.agents` runs 441 across 46. On #77 a CodeRabbit thread reply created 7 empty-bodied reviews on the head, which a review-count wait took for a finished review; the real outcome was a comment "Review rate limited".
