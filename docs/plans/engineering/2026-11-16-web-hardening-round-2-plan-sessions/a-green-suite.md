# Session A — green suite

Plan: [`../2026-11-16-web-hardening-round-2-plan.md`](../2026-11-16-web-hardening-round-2-plan.md). Waits on nothing.

Goal: the nightly e2e (`full-v1` and `full-v2`) is green on this branch, for the right reason, so the owner can make
`e2e (smoke)` a required check.

## Todo, in order

- [ ] 1. Reproduce each failure locally, one spec at a time (`cd apps/web && npx tsx e2e/run.ts <spec>`; v2 specs with
  `NEXT_PUBLIC_OPENCMO_UI=v2`). The CI log of run `43843071368` has the errors; failure videos are in its artifacts.
- [ ] 2. For each failure, decide **app bug or stale test**, and say which in the commit message:
  - a stale test (the product changed on purpose, e.g. `cmo.spec` now gets a script order instead of a calendar
    entry because the founder makes the videos) → update the test to the current rule in `CLAUDE.md`;
  - an app bug (e.g. two `v2-dashboard` nodes rendered at 390 px, a serious axe violation, a page scroll on the
    schedule) → fix the app, keep the test.
  - Never weaken an assertion just to go green; never add a retry to hide a flaky spec.
- [ ] 3. `ui-v2-writer` "filters drafts per platform": fix it and take it out of the `--grep-invert` in
  `test:e2e:smoke` (`apps/web/package.json` — the `test:e2e:smoke` line only).
- [ ] 4. `full-v1` specs for screens v2 replaced: if a v1 screen is no longer reachable in either build, say so to the
  owner in the PR instead of deleting the spec.
- [ ] 5. Run both suites whole, once each, and paste the pass counts into the PR.
- [ ] 6. Lighthouse: read the `lighthouse.yml` comments. If the "warnings only for the first week" switch has a date,
  leave a one-line note in the plan for 2026-11-22 instead of flipping it now.
- [ ] 7. Update the backlog's §1 and §2 state columns for what round 1 and this session made true.
- [ ] 8. `/code-review` your diff, fix, commit (`git add` your paths only), `git pull --rebase`, push.

## Checks before each push

`npm run typecheck`, `cd apps/web && npm run check:contracts`, and the specs you touched.

## For the owner (write here, do not do)

- After a week of green nightly runs: make `e2e (smoke)` a required status check on `main`.
