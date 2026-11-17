# Session B — release safety

Plan: [`../2026-11-17-web-hardening-round-3-plan.md`](../2026-11-17-web-hardening-round-3-plan.md). Waits on nothing.
Do not run a `next build` while another session runs one; pgTAP at the same time is fine.

Goal: a broken production deploy (bad env, missing DSN, empty catalogue, lost headers) is caught within minutes by a
check, not by a founder; a dynamic scan runs every night; the signed-in app has a JS size budget.

Owns: `.github/workflows/post-deploy.yml`, `.github/workflows/dast.yml`, `.zap/**` (all new),
`.github/workflows/ci.yml` (the `web` job's steps only), `apps/web/next.config.ts`, `apps/web/lib/ops/sentry-dsn.ts`,
`apps/web/scripts/smoke-production.mts`, `apps/web/scripts/bundle-budget.mts`, `apps/web/bundle-budget.json` (new).

## Todo, in order

- [x] 1. **Fail the build on a bad Sentry DSN** (round 2 leftover). In `next.config.ts`, when
  `NEXT_PUBLIC_SENTRY_DSN` is set and `readSentryDsn` cannot parse it, throw with an English message that names the
  variable, never its value. Unset stays allowed (local, CI). Add the case to `lib/ops/uptime.check.ts`'s DSN checks
  if `sentry-dsn.ts` changes shape (that check file is round 2's; extend it, do not rewrite it).
- [x] 2. **Smoke after each production deploy**, `.github/workflows/post-deploy.yml`:
  - Trigger: `deployment_status` with `state == 'success'` and the environment `Production` (Vercel's GitHub
    integration posts it). Also `workflow_dispatch`. Read Vercel's docs (`search_vercel_documentation`) to confirm the
    event's fields; do not guess.
  - Target: the production domain from a repository variable (`vars.PRODUCTION_URL`, set by the owner), not
    `environment_url` (the per-deploy URL is behind Vercel's protection). Wait until the domain serves this deploy:
    compare the deploy's commit with what the site reports (find a header or a build id that carries it; if none
    exists, poll `/api/health` for 2 minutes and say so in a comment).
  - `apps/web/scripts/smoke-production.mts`, GET only, no sign-in, no account created: `/api/health` 200 with
    `ok: true`; `/` 200 with the pricing section drawn from the catalogue (a price present, not a hard-coded one);
    `/login`, `/blog`, `/sitemap.xml`, `/robots.txt` 200; CSP and HSTS headers present; the Sentry DSN in the page's
    bundle parses (`readSentryDsn`), which is the round 2 failure checked for good.
  - A failure fails the job (GitHub mails the owner). No secret needed; nothing posts anywhere.
- [x] 3. **DAST, `.github/workflows/dast.yml`**: OWASP ZAP baseline (passive) every night and by hand, against a
  local production build with a local Supabase, the way `lighthouse.yml` does it (reuse its setup steps; copy, don't
  share a composite action this round). ZAP image pinned by digest. `.zap/rules.tsv` sets every rule to `WARN` for
  the first week, each `IGNORE` with a one-line reason. Reports uploaded as an artifact for 14 days. Read ZAP's
  baseline docs first; the scan never touches production.
- [x] 4. **JS budget for the signed-in app**: `apps/web/scripts/bundle-budget.mts` reads the build output after
  `npm run build` in the `web` job and checks the first-load JS of the CMO loop's routes (Today, Writer, Schedule,
  Sales, Settings, and `/` for comparison) against `apps/web/bundle-budget.json` (baseline from this commit + 10 %).
  Next 15: find where the build records per-route chunks (`.next/app-build-manifest.json` or the build trace); say
  which in the script's header. The editor route gets its own, larger line: it is the last step, not the entry.
  Fails the job when a route goes over; the message names the route and the size.
- [x] 5. Update the backlog rows you own (plan, "Shared files").
- [x] 6. **Review**: `/code-review high` on your diff, then the `security-review-checklist` skill (workflows:
  `permissions:` least privilege, no `pull_request_target`, no untrusted input in `run:`, actions and images pinned).
  Fix what is confirmed. Commit (`git add` your paths only, message ends with the review line), `git pull --rebase`,
  push.

## Checks before each push

`npm run typecheck`, `cd apps/web && npm run check:contracts`, `npm run build` then the budget script, and
`npx tsx apps/web/scripts/smoke-production.mts` against a local `next start` (with `PRODUCTION_URL` pointed at it).
Workflows: `actionlint` if available (download to the scratchpad), and one `workflow_dispatch` run per new workflow
after the push, linked in the PR.

## Done (session B, 2026-11-17)

1. `assertSentryDsn` in `lib/ops/sentry-dsn.ts`, called from `next.config.ts`'s `headers()` (run by `next build`, not
   by `next start`): a set but unparsable DSN fails the build with a message that names the variable, never its value.
   Cases added to `uptime.check.ts`. Checked: a build with a cut-off DSN stops at once with that message.
2. `post-deploy.yml` + `scripts/smoke-production.mts`. Vercel's docs (searched with `search_vercel_documentation`)
   confirm `deployment_status` with `environment_url`, and now also offer `repository_dispatch`
   (`vercel.deployment.promoted`, payload `url`); only `deployment_status` is used, so one deploy starts one run (the
   switch is written in the workflow's header). No header or build id carried the commit, so `next.config.ts` now adds
   `X-Deploy-Commit` (Vercel's `VERCEL_GIT_COMMIT_SHA`, read at build) and the script waits up to 5 minutes for it
   to match `deployment.sha`. A custom build id was tried first and dropped at review: it kept the same id across
   redeploys of one commit and skipped Next's ad-blocker guard. Known limit: a redeploy of the same commit cannot be
   told from the deploy it replaces. Until `PRODUCTION_URL` is set, a deploy's run warns and stays green.
   Also from the ZAP run: `poweredByHeader: false` (ZAP 10037, `X-Powered-By: Next.js`).
3. `dast.yml` + `.zap/rules.tsv`: ZAP 2.17.0 baseline, nightly at 03:17 UTC and by hand, image pinned by digest
   (`sha256:9624669d…`, same index on ghcr.io and Docker Hub). Rules generated with `zap-baseline.py -g` from that
   image: 56 WARN, 5 IGNORE (informational rules and "ZAP out of date"), each with its reason. Local run against this
   build: 0 FAIL; warnings: CSP `unsafe-inline` (10055, the documented choice in `next.config.ts`), Content-Type
   missing on redirect responses (10019), X-Powered-By (10037, fixed in this commit).
4. `scripts/bundle-budget.mts` reads `.next/app-build-manifest.json` (per App Router page: shared, layout and page
   chunks) and gzips the `.js` files, which matches `next build`'s First Load JS column. `bundle-budget.json`:
   baseline + 10 %, rounded up; the editor has its own line. Step added to `ci.yml`'s `web` job after `npm run build`.
5. Backlog rows §1 "Smoke test", §2 "Performance budget", "Bundle size", §5 "SAST, DAST".
6. Review: `/code-review high` and `security-review-checklist`; see the commit message.

Checks run in this container: `npm run typecheck` ✓, `check:contracts` ✓, `npm run build` ✓, budget script ✓ (and
fails when a line is lowered below its route), smoke against a local `next start` ✓ (and fails on an empty catalogue
and on a commit the site does not serve). That build pointed at a stub of PostgREST serving the Lighthouse seed's
made-up catalogue: this container cannot pull Supabase's images (ghcr blobs are blocked), and its own env points at
production, which the local checks were kept away from. `actionlint` was not run (downloading it was not allowed
here); the workflow YAML was parsed and checked by hand. `workflow_dispatch` runs: GitHub only dispatches workflows
that exist on the default branch, so the first runs of `post-deploy.yml` and `dast.yml` happen once #228 merges.

## For the owner (write here, do not do)

- GitHub → Settings → Secrets and variables → Actions → Variables: `PRODUCTION_URL` = the production origin
  (e.g. `https://opencmo.io`, no trailing slash). Until then the post-deploy run warns and checks nothing.
- After merging: run **Post-deploy smoke** and **DAST** once by hand (Actions → the workflow → Run workflow), and
  confirm the first production deploy starts a Post-deploy smoke run (if none starts, Vercel no longer posts
  `deployment_status` for this project: switch the trigger as the workflow's header says).
- After a week of green nightly ZAP runs: turn the warnings that held into `FAIL` in `.zap/rules.tsv`.
- The repository is private now: DAST adds about 20 Actions minutes a night.

## For the lead

- `CLAUDE.md`, "Running": after `npm run build`, `cd apps/web && npx tsx scripts/bundle-budget.mts` (the JS budget CI
  checks); and "Known traps": a deploy is checked by `post-deploy.yml`, which needs the `PRODUCTION_URL` variable.
- `.github/workflows/ci.yml`'s header still says "the repo is public, so Actions minutes are free" (not B's block).
- `apps/web/lib/ops/uptime.check.ts` (round 2's file) got the build-gate cases, as item 1 asked.
