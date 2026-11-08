# Stacked pull request chains

## Build

1. Split the change into work units of about 400 lines that each build, type-check and pass the tests on their own. Split by layer (types, model, services, adapters, CLI) so each unit only needs the ones before it. Never trim tests or docs to fit.
2. One branch per unit, named in order: `feat/<topic>-<n>-<slug>`. The first targets `dev`; each next one targets the branch before it.
3. Each pull request body says its place in the chain, what comes before and after, and a diagram (Mermaid or ASCII) that marks the current one with 📍. A unit over budget says why (for example, most lines are tests).
4. CI runs on every pull request of the chain, so each unit is checked on Linux and Windows.

## Fix an early pull request

A fix pushed to pull request 1 is not in the branches after it, so its CI never meets the rules the later pull requests add. That is how a relative import in a test fixed on the first pull request broke `dev` once the last one, which bans relative imports, was merged.

Before pushing the fix, check it at the tip:

```bash
git switch --detach <tip branch>
git cherry-pick <fix commit>
bun run lint && bun run typecheck && bun run test
git switch -
```

Putting the fix inside the earlier commit instead (amend, then cherry-pick every later commit on top) rewrites every later branch: the maintainer force-pushes them with the commands you give.

## Merge

In order, one at a time, each only after the maintainer decides:
1. Retarget it to `dev` if its base is the merged branch before it: `gh pr edit <n> --base dev`.
2. Wait for CI and CodeRabbit (`waiting.md`), report, and wait for the decision.
3. `gh pr merge <n> --merge`.

After the last one, wait for the CI run of the `dev` push. It is the first run that checks the whole chain together; a failure there is fixed with one more pull request into `dev`.
