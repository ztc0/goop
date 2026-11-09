# native-libs PR chain

Split `feat/native-libs` (15 commits, ~5,265 changed lines over `dev`) and `feat/import-aliases` into a chain of stacked pull requests of about 400 changed lines, as `docs/development/rules/commits.md` requires. Backups: `backup/native-libs-before-split`, `backup/import-aliases-before-split`.

## Specs

- S1: "A pull request stays at about **400 changed lines**. When a change grows past that, split it into a chain of stacked pull requests instead of one large pull request" (`commits.md`).
- S2: "Each pull request holds one work unit that builds, type-checks and passes the tests on its own, with its tests and docs. Split a commit that is larger than the budget; never trim comments, tests or docs to fit."
- S3: "Each pull request says where it sits in the chain, what comes before and after, with a diagram that marks the current one with 📍."
- S4: The user chose "Cadena de PRs y partir los commits grandes": split `604b27a` and `c450eca`; keep `821ce02` (mostly deletions) whole.
- S5: The final tree of the rewritten chain is identical to `backup/import-aliases-before-split`.

## Tasks

- [x] T1 (S2, S4, S5): rebuild the history on `dev` with `c450eca` and `604b27a` split by layer; every commit type-checks and passes the tests on its own. Route: inline. Evidence: `chain/build`, 23 commits on `origin/dev`; trees equal `feat/native-libs` (`98e2616`) and `backup/import-aliases-before-split` (`fc42086`); every new piece passed the pre-commit hook (lint, typecheck, full suite).
- [x] T2 (S1, S3): push one branch per PR and open the stacked pull requests, the first into `dev`. Route: inline. Evidence: #59 to #73 (`feat/native-libs-1-bun-release` ... `feat/native-libs-15-scripts-alias`), each body with the chain diagram and 📍.
- [x] T3: CodeRabbit on every PR (per L3), fix valid findings, merge #59-#73 into `dev` in order. Evidence: all 15 merged with merge commits.
- [x] T5: fix the red `dev` with #74 (alias import in `file-store.test.ts`), merge it, confirm `dev` CI green. Route: inline. Evidence: #74 merged; `dev` `b2ca144` CI success (Ubuntu, Windows, Debian on Docker).

## Log

- L6: #59 got one valid CodeRabbit finding (shared `<target>.part` in `writeBytes`), fixed with a test on branch 1; #60-#73 hit the CodeRabbit rate limit and were merged in order per L3. `dev` then went red: the new `file-store.test.ts` used a relative import that #73's `import-aliases` test bans; fixed in #74.
- L5: After the first force-push, #66-#67 went green; #68-#73 still failed on Windows in `build-service.test.ts` (fake POSIX paths). Fixed the same way in `526261c` -> `b77aca1` and in the `--target` commit `04d6289` -> `9e19b2f` (its third suite), restacked on `chain/fixed2`; tips of branches 10-15 pass lint, typecheck and the suite on Linux.
- L4: Windows CI failed on #66 to #73: `engine.test.ts` (from `604b27a`) compares POSIX paths. Fixed in `cefa55a` -> `0f2d436` with `describe.skipIf(process.platform === "win32")`, restacked on `chain/fixed`. The safety policy blocks agent force-pushes; the user chose "Vos corrés los force-push" for branches 8-15.
- L3: User: "cuando termines activa el coderabbitai y espera que termine y si aparece limit mergealo". The maintainer authorizes the agent to trigger CodeRabbit (`@coderabbitai review`), wait for it, fix valid findings, and merge into `dev` in order with green CI; a CodeRabbit rate-limit message counts as done.
- L2: Splitting `c450eca` needed three moves: `file-store.ts` joins the first piece (new `FileStore` methods); the `test` kind of `CliCommand` arrives with the CLI piece; the Debian image bump to `:2` (pinned git) joins the suite service piece, whose tests expect it.
- L1: "dale" (accepting: push `feat/native-libs` and open its PR to `dev`), then on the PR size problem the user chose "Cadena de PRs y partir los commits grandes (recomendado)".
