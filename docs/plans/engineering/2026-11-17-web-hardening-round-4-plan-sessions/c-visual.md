# Session C — the loop's screens stay put

Plan: [`../2026-11-17-web-hardening-round-4-plan.md`](../2026-11-17-web-hardening-round-4-plan.md). Waits on nothing.

Goal: a broken layout on the CMO loop's screens fails the nightly suite with a picture of the difference, and a JS
budget failure comes with a report of which library grew.

Read first: `apps/web/playwright.config.ts`, `apps/web/e2e/ui-v2-seed.ts`, `ui-v2-look.spec.ts` (round 2's layout
checks), `.github/workflows/e2e.yml`, `apps/web/scripts/bundle-budget.mts`, `apps/web/bundle-budget.json`, CLAUDE.md
"Strategy" (which screens are the loop).

## Todo, in order

- [ ] 1. **Pick the screens**: the CMO loop in order (business info / setup, today or dashboard, Writer, a post card
  waiting for approval, the slideshow page, Schedule). One shot each at 1440 × 900 and at 390 × 844, light theme;
  plus the dashboard in dark. About 13 images; no more than 16.
- [ ] 2. **Make them stable** before taking any baseline: seed through `ui-v2-seed.ts`, freeze the clock
  (`page.clock`), turn off animations and the caret (`toHaveScreenshot`'s `animations: "disabled"`, `caret: "hide"`),
  wait for fonts (`document.fonts.ready`), mask what changes run to run (times, relative dates, avatars, ids).
  Run each shot three times in a row locally; all three must pass with the default threshold. If one needs a
  threshold above `maxDiffPixelRatio: 0.01`, mask more instead.
- [ ] 3. **`apps/web/e2e/ui-v2-visual.spec.ts`** with the baselines committed. Snapshot settings in
  `playwright.config.ts` only (path template without the OS so one set of baselines serves CI, `expect.toHaveScreenshot`
  defaults). Not in the smoke set; it runs in the nightly `full-v2`.
- [ ] 4. **Prove it in CI**, because CI's fonts and Chromium decide: trigger `e2e.yml` on this branch
  (`workflow_dispatch`; it exists on `main`, so a run on the branch works) and read the result. If CI's pixels differ
  from your container's, take the baselines from CI: add a `workflow_dispatch` input `update_snapshots` to `e2e.yml`
  that runs the spec with `--update-snapshots` and uploads the new images as an artifact; download them, commit, run
  again green. Write that update path at the top of the spec.
- [ ] 5. **Every shot is a real screen**: look at each baseline at full size before committing it. A baseline of a
  broken screen is worse than none. If one shows an app bug (overflow, overlap, cut text), fix the component and keep
  the shot; say which in the commit.
- [ ] 6. **Bundle report on a budget failure**: `@next/bundle-analyzer` (MIT) as a devDependency, enabled only when
  `ANALYZE=1` (the wrapper in `next.config.ts`, nothing else there). In `ci.yml`'s `web` job, when the budget step
  fails, build again with `ANALYZE=1` and upload the client report as an artifact; `bundle-budget.mts`'s failure
  message says where to find it. Check by lowering one line of `bundle-budget.json` locally (do not commit that).
- [ ] 7. The backlog's §1 "Visual regression test" and §2 "Bundle size, bundle analyzer" rows.

## Checks before each push

`npm run typecheck`, `cd apps/web && npm run check:contracts`, the new spec three times, `next build` and
`npx tsx scripts/bundle-budget.mts`, the CI run of item 4 (link it in the commit).

## For the owner (write here, do not do)

- When a screen changes on purpose, the nightly run fails with a diff: run `e2e.yml` by hand with `update_snapshots`,
  look at the images, commit them.

## For the lead

(Lines for `CLAUDE.md`.)
