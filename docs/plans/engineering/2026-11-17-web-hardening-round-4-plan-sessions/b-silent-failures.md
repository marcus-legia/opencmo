# Session B — silent failures and alerts

Plan: [`../2026-11-17-web-hardening-round-4-plan.md`](../2026-11-17-web-hardening-round-4-plan.md). Waits on nothing.

Goal: the owner sees the worker's silent fallbacks next to the failures, Sentry tells the owner when a new group of
founder failures appears, and there is a written runbook for an incident.

Read first: `supabase/migrations/20270128010000_ops_failures_report.sql` (the report and how it groups),
`apps/web/lib/ops/failures.ts`, `apps/web/app/app/settings/failures/**`, `apps/web/lib/ops/cron-monitor.ts`,
`packages/engine/opencmo/worker/process_job.py` (`_transcribe`, `_focus`, `complete_job_publication`), the
`supabase-migrations` and `security-review-checklist` skills, CLAUDE.md "Known traps".

## Todo, in order

- [ ] 1. **Engine: say why.** Today `_transcribe` returns `None` for "no speech" and for "Scribe failed", and `_focus`
  returns `None` both when no tracking was needed and when the face detector was missing. Make each return the
  reason too, and publish the reasons with the job as a short list of codes (e.g. `transcript_failed`,
  `framing_centre_no_detector`): through `complete_job_publication`, into whatever the job already stores (read the
  RPC first; add a column only if nothing fits). "No speech" is not a warning; a real error is. Codes only, never
  the exception text with a key or a URL in it. Engine tests for each case.
- [ ] 2. **Migration `20270130010000_ops_warnings_and_alerts.sql`**:
  - the RPC change item 1 needs (new signature or a jsonb field; keep the old call working until the worker deploys,
    because the web and Modal deploy separately);
  - move the report's grouping into one internal function, `ops_failure_groups(p_since timestamptz)`, executable by
    `service_role` only, and make `ops_failures_report` (owner check unchanged) call it, so the page and the alert
    group the same way;
  - the report gains a `warnings` section from item 1's codes: per code, count, accounts, last seen, a few job ids.
  - Round 3's `320_advisor_guard` applies: `search_path = ''`, no per-row `auth.uid()`.
  - A's migration (`20270129…`) revokes every table grant from `anon` and `authenticated` before yours: a new column
    needs nothing, a new table or view needs its grant here and a line under "For B" in A's checklist.
- [ ] 3. **pgTAP `325_ops_warnings_and_alerts.test.sql`**: warnings show for the owner and not for a founder;
  `ops_failure_groups` refuses `authenticated` and `anon`; the report's existing cases in `322_*` still pass unchanged.
  Add the new function to `182_*` (block "B") only if `authenticated` may call it (it should not).
- [ ] 4. **Page**: `/app/settings/failures` shows a "Warnings" section under the groups (same look, empty state
  "No warnings"). Pure shaping in `failures.ts`, cases in `failures.check.ts`. Look at it at 1440 and 390 px with
  seeded rows.
- [ ] 5. **Alert**: a cron route `/api/cron/failures` (same auth as the other cron routes, `CRON_SECRET`) reads
  `ops_failure_groups(now() - interval '1 hour')` with the service-role client and sends one Sentry event per group
  (`captureMessage`, level `error` for failures and stuck work, `warning` for warnings) with a fingerprint
  `["founder-failure", source, kind, key]`, so Sentry keeps one issue per group and its default "new issue" alert
  emails the owner once. Send counts and the group key only: no user id, no email, no error text that might hold
  founder content beyond the grouped key. Does nothing when the DSN is unset. Logic pure in
  `lib/ops/failure-alerts.ts` with `failure-alerts.check.ts`; Modal's hourly digest function calls the route after
  the digest (one line in `modal_app.py`; no new Modal function). The route checks in to a cron monitor like the
  others.
- [ ] 6. **Runbook `docs/runbooks/incident.md`**: how the owner learns (Sentry alert, uptime monitor, failures page,
  a founder's email), the first ten minutes (Vercel instant rollback, `modal deploy` of the previous commit, a
  migration is never rolled back, only fixed forward), how to tell founders (`support@opencmo.io`, credits back
  through `credit_refund`), and a short postmortem template. Plain, one page.
- [ ] 7. `scripts/dump-schema.sh`, then the backlog's §3 rows "Observability", "Alerting, on-call", "Dead letter
  queue", "Incident, postmortem".

## Checks before each push

`npm run db:reset && npm run db:test`, `scripts/dump-schema.sh`, `npm run typecheck`,
`cd apps/web && npm run check:contracts` and your `.check.ts` files, engine:
`.venv312/bin/python -m pytest -q <your tests>` and `ruff check .`.

## For A

(Grants your new objects need, one line each: object, role, privilege, the file that reads it.)

## For the owner (write here, do not do)

- After the merge: `supabase db push`, then the web deploy, then `modal deploy` (the worker publishes the codes, the
  hourly function calls the alert route). Order matters: the database first.
- Sentry → Alerts: check that the default "new issue" rule emails you (one rule is enough; the fingerprint makes one
  issue per failure group).

## For the lead

(Lines for `CLAUDE.md` or `lib/supabase/admin.ts`.)
