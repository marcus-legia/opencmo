# Session B — silent failures and alerts

Plan: [`../2026-11-17-web-hardening-round-4-plan.md`](../2026-11-17-web-hardening-round-4-plan.md). Waits on nothing.

Goal: the owner sees the worker's silent fallbacks next to the failures, Sentry tells the owner when a new group of
founder failures appears, and there is a written runbook for an incident.

Read first: `supabase/migrations/20270128010000_ops_failures_report.sql` (the report and how it groups),
`apps/web/lib/ops/failures.ts`, `apps/web/app/app/settings/failures/**`, `apps/web/lib/ops/cron-monitor.ts`,
`packages/engine/opencmo/worker/process_job.py` (`_transcribe`, `_focus`, `complete_job_publication`), the
`supabase-migrations` and `security-review-checklist` skills, CLAUDE.md "Known traps".

## Todo, in order

- [x] 1. **Engine: say why.** Today `_transcribe` returns `None` for "no speech" and for "Scribe failed", and `_focus`
  returns `None` both when no tracking was needed and when the face detector was missing. Make each return the
  reason too, and publish the reasons with the job as a short list of codes (e.g. `transcript_failed`,
  `framing_centre_no_detector`): through `complete_job_publication`, into whatever the job already stores (read the
  RPC first; add a column only if nothing fits). "No speech" is not a warning; a real error is. Codes only, never
  the exception text with a key or a URL in it. Engine tests for each case.
- [x] 2. **Migration `20270130010000_ops_warnings_and_alerts.sql`**:
  - the RPC change item 1 needs (new signature or a jsonb field; keep the old call working until the worker deploys,
    because the web and Modal deploy separately);
  - move the report's grouping into one internal function, `ops_failure_groups(p_since timestamptz)`, executable by
    `service_role` only, and make `ops_failures_report` (owner check unchanged) call it, so the page and the alert
    group the same way;
  - the report gains a `warnings` section from item 1's codes: per code, count, accounts, last seen, a few job ids.
  - Round 3's `320_advisor_guard` applies: `search_path = ''`, no per-row `auth.uid()`.
  - A's migration (`20270129…`) revokes every table grant from `anon` and `authenticated` before yours: a new column
    needs nothing, a new table or view needs its grant here and a line under "For B" in A's checklist.
- [x] 3. **pgTAP `325_ops_warnings_and_alerts.test.sql`**: warnings show for the owner and not for a founder;
  `ops_failure_groups` refuses `authenticated` and `anon`; the report's existing cases in `322_*` still pass unchanged.
  Add the new function to `182_*` (block "B") only if `authenticated` may call it (it should not).
- [x] 4. **Page**: `/app/settings/failures` shows a "Warnings" section under the groups (same look, empty state
  "No warnings"). Pure shaping in `failures.ts`, cases in `failures.check.ts`. Look at it at 1440 and 390 px with
  seeded rows.
- [x] 5. **Alert**: a cron route `/api/cron/failures` (same auth as the other cron routes, `CRON_SECRET`) reads
  `ops_failure_groups(now() - interval '1 hour')` with the service-role client and sends one Sentry event per group
  (`captureMessage`, level `error` for failures and stuck work, `warning` for warnings) with a fingerprint
  `["founder-failure", source, kind, key]`, so Sentry keeps one issue per group and its default "new issue" alert
  emails the owner once. Send counts and the group key only: no user id, no email, no error text that might hold
  founder content beyond the grouped key. Does nothing when the DSN is unset. Logic pure in
  `lib/ops/failure-alerts.ts` with `failure-alerts.check.ts`; Modal's hourly digest function calls the route after
  the digest (one line in `modal_app.py`; no new Modal function). The route checks in to a cron monitor like the
  others.
- [x] 6. **Runbook `docs/runbooks/incident.md`**: how the owner learns (Sentry alert, uptime monitor, failures page,
  a founder's email), the first ten minutes (Vercel instant rollback, `modal deploy` of the previous commit, a
  migration is never rolled back, only fixed forward), how to tell founders (`support@opencmo.io`, credits back
  through `credit_refund`), and a short postmortem template. Plain, one page.
- [x] 7. `scripts/dump-schema.sh`, then the backlog's §3 rows "Observability", "Alerting, on-call", "Dead letter
  queue", "Incident, postmortem".

## Checks before each push

`npm run db:reset && npm run db:test`, `scripts/dump-schema.sh`, `npm run typecheck`,
`cd apps/web && npm run check:contracts` and your `.check.ts` files, engine:
`.venv312/bin/python -m pytest -q <your tests>` and `ruff check .`.

## For A

Nothing: B creates no table or view. Its one new function, `ops_failure_groups(timestamptz)`, is executable by
`service_role` only (granted in B's migration), and its new index needs no grant.

## For the owner (write here, do not do)

- After the merge: `supabase db push`, then the web deploy, then `modal deploy` (the worker publishes the codes, the
  hourly function calls the alert route). Order matters: the database first.
- Sentry → Alerts: check that the default "new issue" rule emails you (one rule is enough; the fingerprint makes one
  issue per failure group).

## For the lead

- `lib/supabase/admin.ts`, the comment listing who may use the service role: add "the founder-failure alert
  (`app/api/cron/failures`)".
- `CLAUDE.md` "Known traps", the Scribe and face-tracking bullets: they are no longer silent. Suggested line: "Both
  fallbacks write a code in `jobs.media_manifest.warnings` (`transcript_failed`, `framing_centre_*`); the owner reads
  them under Warnings at `/app/settings/failures`, and the hourly `/api/cron/failures` sends them to Sentry."
- `apps/web/package.json` (C's this round): `failure-alerts.check.ts` runs through an import at the end of
  `failures.check.ts`, so `check:contracts` covers it without touching the script. Give it its own entry in
  `check:contracts` once C is done, and drop the import.
- `lib/ops/cron-monitor.ts` is nobody's: `FAILURES_MONITOR` lives in `lib/ops/failure-alerts.ts`, and
  `failure-alerts.check.ts` checks its schedule against `modal_app.py`. Moving it into `CRON_MONITORS` (and its
  schedule assert into `uptime.check.ts`) is a small cleanup the review suggested.

## Done (session B, 2026-11-17)

- **Engine:** `_transcribe` and `_focus` now return a reason code along with their result. Codes are `transcript_failed`,
  `framing_centre_no_detector`, `framing_centre_no_frames` and `framing_centre_tracking_failed`; "no speech" and
  "no face" are not warnings. The worker publishes them as `media_manifest.warnings` through `complete_job_publication`,
  which already stores the manifest whole, so there is **no RPC or column change**: old and new workers both work with
  the migration. If `OPENCMO_FACE_MODEL` is unset (dev only), the detector check does not download the model, so a dev
  machine reports `framing_centre_no_frames` where production would say "no detector". 8 new pytest cases (29 pass),
  ruff clean.
- **Migration `20270130010000`:** `ops_failure_groups(p_since)` holds the grouping, copied line for line, plus
  `warnings` (per code: jobs, accounts, first/last seen, five newest job ids). Only codes matching
  `^[a-z][a-z0-9_]{0,63}$` count, and owner accounts are left out. The function is `security definer` with
  `search_path ''` and is executable only by `service_role`. `ops_failures_report` keeps its owner check and window
  and returns the same keys plus `warnings`. A partial index covers the jobs that carry warnings.
- **pgTAP `325`** (14 tests): the grants; the founder refusal; the counts, window, owner exclusion, a repeated code,
  junk codes and the row shape; the alert and the page seeing identical groups and warnings. `322` passes unchanged.
  Full suite: 214 files, 3575 tests pass on the pinned CLI 2.117.0. `db lint` shows nothing new. `182` is untouched
  because `authenticated` cannot call the new function. Schema dump regenerated: the diff covers only the two
  functions and the index.
- **Page:** a "Warnings" section under the groups, in the same panels, with "No warnings" when empty. I looked at it at
  1440 and 390 px with seeded failures and warnings: no sideways scroll, and a founder gets the 404.
- **Alert:** `/api/cron/failures` checks `CRON_SECRET`, then the DSN, then reads `ops_failure_groups` over the last
  **two hours**, not one. The call lands at :02 to :05 after the digest, so an exact hour would leave gaps; the
  fingerprint folds repeats into one issue. It sends one `captureMessage` per group: `error` for failures and stuck
  work, `warning` for warnings, fingerprint `["founder-failure", source, kind, key]`. Events carry counts and the
  grouped key, never ids. The route checks in to the `cron-failures` monitor.
  - Verified locally: wrong secret gives 401. No DSN gives `{sent:0}` with no database read. A fake DSN with one
    failure group and one warning gives `{sent:2}`. Through PostgREST, anon gets 42501 and service_role gets the
    answer.
  - Modal's `cmo_digest` calls the route after the digest, and still calls it when the digest fails (then re-raises).
    Its timeout went from 150 to 210 s.
- **Known and accepted:** the grouped key can still name a founder's file or site. It goes to Sentry because the plan
  allows the grouped key, and without it an issue cannot say which bug it is. Stuck work sends an event every hour
  while it stays stuck (the runbook says so).
- **Runbook** `docs/runbooks/incident.md`. **Backlog** §3 rows updated.
- **Reviews:** `/code-review high` found 8 issues. Fixed 6: the alert being skipped when the digest failed, gaps
  between alert windows, the privacy comment that claimed too much, the runbook's wording on stuck work, the model
  download on the upload path, and the unindexed scan. Left 2, because the files belong to C or nobody this round:
  `FAILURES_MONITOR` outside `CRON_MONITORS`, and the check wired through an import (both are above under "For the
  lead"). The `security-review-checklist` raised nothing.
