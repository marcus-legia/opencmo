# Session C — the loop's screens stay put

Plan: [`../2026-11-17-web-hardening-round-4-plan.md`](../2026-11-17-web-hardening-round-4-plan.md). Waits on nothing.

Goal: a broken layout on the CMO loop's screens fails the nightly suite with a picture of the difference, and a JS
budget failure comes with a report of which library grew.

Read first: `apps/web/playwright.config.ts`, `apps/web/e2e/ui-v2-seed.ts`, `ui-v2-look.spec.ts` (round 2's layout
checks), `.github/workflows/e2e.yml`, `apps/web/scripts/bundle-budget.mts`, `apps/web/bundle-budget.json`, CLAUDE.md
"Strategy" (which screens are the loop).

## Todo, in order

- [x] 1. **Pick the screens**: the CMO loop in order (business info / setup, today or dashboard, Writer, a post card
  waiting for approval, the slideshow page, Schedule). One shot each at 1440 × 900 and at 390 × 844, light theme;
  plus the dashboard in dark. About 13 images; no more than 16.
- [x] 2. **Make them stable** before taking any baseline: seed through `ui-v2-seed.ts`, freeze the clock
  (`page.clock`), turn off animations and the caret (`toHaveScreenshot`'s `animations: "disabled"`, `caret: "hide"`),
  wait for fonts (`document.fonts.ready`), mask what changes run to run (times, relative dates, avatars, ids).
  Run each shot three times in a row locally; all three must pass with the default threshold. If one needs a
  threshold above `maxDiffPixelRatio: 0.01`, mask more instead.
- [x] 3. **`apps/web/e2e/ui-v2-visual.spec.ts`** with the baselines committed. Snapshot settings in
  `playwright.config.ts` only (path template without the OS so one set of baselines serves CI, `expect.toHaveScreenshot`
  defaults). Not in the smoke set; it runs in the nightly `full-v2`.
- [ ] 4. **Prove it in CI**, because CI's fonts and Chromium decide: trigger `e2e.yml` on this branch
  (`workflow_dispatch`; it exists on `main`, so a run on the branch works) and read the result. If CI's pixels differ
  from your container's, take the baselines from CI: add a `workflow_dispatch` input `update_snapshots` to `e2e.yml`
  that runs the spec with `--update-snapshots` and uploads the new images as an artifact; download them, commit, run
  again green. Write that update path at the top of the spec.
  - **Not finished: CI's baselines are not committed yet.** Done: the `update_snapshots` input and the path in the
    spec's header; [run 44033495535](https://github.com/marcus-legia/opencmo/actions/runs/44033495535) made CI's 13
    images (artifact `e2e-visual-snapshots`, id 14306860731, kept until 2026-11-24). The nightly suite on this branch
    ([run 44034618134](https://github.com/marcus-legia/opencmo/actions/runs/44034618134)) proves CI's pixels differ
    from the container's: 12 of 13 shots fail (setup 1440 passes), 104 other full-v2 tests pass, full-v1 green.
    Blocked: this session could not download the artifact (GitHub serves it from
    `productionresultssa1.blob.core.windows.net`; the host was added to the environment, then the download itself was
    refused by the session's permission check). Until the owner's step below, `full-v2` fails on these 12 shots.
- [x] 5. **Every shot is a real screen**: look at each baseline at full size before committing it. A baseline of a
  broken screen is worse than none. If one shows an app bug (overflow, overlap, cut text), fix the component and keep
  the shot; say which in the commit.
- [x] 6. **Bundle report on a budget failure**: `@next/bundle-analyzer` (MIT) as a devDependency, enabled only when
  `ANALYZE=1` (the wrapper in `next.config.ts`, nothing else there). In `ci.yml`'s `web` job, when the budget step
  fails, build again with `ANALYZE=1` and upload the client report as an artifact; `bundle-budget.mts`'s failure
  message says where to find it. Check by lowering one line of `bundle-budget.json` locally (do not commit that).
- [x] 7. The backlog's §1 "Visual regression test" and §2 "Bundle size, bundle analyzer" rows.

## Checks before each push

`npm run typecheck`, `cd apps/web && npm run check:contracts`, the new spec three times, `next build` and
`npx tsx scripts/bundle-budget.mts`, the CI run of item 4 (link it in the commit).

## For the owner (write here, do not do)

- **Once, now** (item 4): open run 44033495535 → Artifacts → `e2e-visual-snapshots`, download, look at the 13 images,
  copy them over `apps/web/e2e/ui-v2-visual.spec.ts-snapshots/`, commit, and run `e2e.yml` by hand without the box:
  `full-v2` should pass. (Or let a session with that download allowed do it.)

- When a screen changes on purpose, the nightly run fails with a diff: run `e2e.yml` by hand with `update_snapshots`,
  look at the images, commit them.

## For the lead

- `CLAUDE.md` "Running": `cd apps/web && npm run test:e2e:visual` (the loop's screenshots; baselines come from CI, see
  the spec's header), and `ANALYZE=1 NEXT_PUBLIC_OPENCMO_UI=v2 npm run build` → `apps/web/.next/analyze/client.html`
  for which library a route's JS comes from.
- Outside my list, one line each: `e2e/ui-v2-seed.ts` exports `ONBOARDING_DOCUMENT` (the visual spec seeds its own
  founder with the same document instead of a copy), `package-lock.json` (the analyzer's packages, additions only,
  npm 11), and three app CSS fixes the screenshots proved (`styles/today.css`, `styles/today-app.css`,
  `components/today/PhotoPostPanel.tsx`; listed in the commit).

## Done

Items 1, 2, 3, 5, 6, 7 done; item 4 half done (above). Verified: the spec 13/13, then `--repeat-each 3` 39/39 at the
default threshold (local, Playwright's Chromium); every baseline looked at full size, four app bugs they showed fixed
(Writer composer cut at 390, inbox card text against its border, Calendar's Posted chip 12px low, slideshow page's
buttons unstyled); `npm run typecheck`, `check:contracts`, v2 `next build` + `bundle-budget.mts` green; with
`/app/writer` lowered locally the budget fails, its message points at the report, and `ANALYZE=1` writes
`.next/analyze/client.html`; CI: the update job green and uploaded 13 images, the nightly run shows the expected 12
pixel failures against container baselines. `/code-review high` (10 findings, all fixed) and the security checklist
(nothing) on the diff, in commit 967d231.
