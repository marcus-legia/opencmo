# Session B — release safety

Plan: [`../2026-11-17-web-hardening-round-3-plan.md`](../2026-11-17-web-hardening-round-3-plan.md). Waits on nothing.
Do not run a `next build` while another session runs one; pgTAP at the same time is fine.

Goal: a broken production deploy (bad env, missing DSN, empty catalogue, lost headers) is caught within minutes by a
check, not by a founder; a dynamic scan runs every night; the signed-in app has a JS size budget.

Owns: `.github/workflows/post-deploy.yml`, `.github/workflows/dast.yml`, `.zap/**` (all new),
`.github/workflows/ci.yml` (the `web` job's steps only), `apps/web/next.config.ts`, `apps/web/lib/ops/sentry-dsn.ts`,
`apps/web/scripts/smoke-production.mts`, `apps/web/scripts/bundle-budget.mts`, `apps/web/bundle-budget.json` (new).

## Todo, in order

- [ ] 1. **Fail the build on a bad Sentry DSN** (round 2 leftover). In `next.config.ts`, when
  `NEXT_PUBLIC_SENTRY_DSN` is set and `readSentryDsn` cannot parse it, throw with an English message that names the
  variable, never its value. Unset stays allowed (local, CI). Add the case to `lib/ops/uptime.check.ts`'s DSN checks
  if `sentry-dsn.ts` changes shape (that check file is round 2's; extend it, do not rewrite it).
- [ ] 2. **Smoke after each production deploy**, `.github/workflows/post-deploy.yml`:
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
- [ ] 3. **DAST, `.github/workflows/dast.yml`**: OWASP ZAP baseline (passive) every night and by hand, against a
  local production build with a local Supabase, the way `lighthouse.yml` does it (reuse its setup steps; copy, don't
  share a composite action this round). ZAP image pinned by digest. `.zap/rules.tsv` sets every rule to `WARN` for
  the first week, each `IGNORE` with a one-line reason. Reports uploaded as an artifact for 14 days. Read ZAP's
  baseline docs first; the scan never touches production.
- [ ] 4. **JS budget for the signed-in app**: `apps/web/scripts/bundle-budget.mts` reads the build output after
  `npm run build` in the `web` job and checks the first-load JS of the CMO loop's routes (Today, Writer, Schedule,
  Sales, Settings, and `/` for comparison) against `apps/web/bundle-budget.json` (baseline from this commit + 10 %).
  Next 15: find where the build records per-route chunks (`.next/app-build-manifest.json` or the build trace); say
  which in the script's header. The editor route gets its own, larger line: it is the last step, not the entry.
  Fails the job when a route goes over; the message names the route and the size.
- [ ] 5. Update the backlog rows you own (plan, "Shared files").
- [ ] 6. **Review**: `/code-review high` on your diff, then the `security-review-checklist` skill (workflows:
  `permissions:` least privilege, no `pull_request_target`, no untrusted input in `run:`, actions and images pinned).
  Fix what is confirmed. Commit (`git add` your paths only, message ends with the review line), `git pull --rebase`,
  push.

## Checks before each push

`npm run typecheck`, `cd apps/web && npm run check:contracts`, `npm run build` then the budget script, and
`npx tsx apps/web/scripts/smoke-production.mts` against a local `next start` (with `PRODUCTION_URL` pointed at it).
Workflows: `actionlint` if available (download to the scratchpad), and one `workflow_dispatch` run per new workflow
after the push, linked in the PR.

## For the owner (write here, do not do)

- GitHub → Settings → Variables: `PRODUCTION_URL` = the production domain.
- After a week of green nightly ZAP runs: turn the warnings that held into `FAIL` in `.zap/rules.tsv`.

## For the lead

(Lines that belong in `CLAUDE.md` or files B does not own.)
