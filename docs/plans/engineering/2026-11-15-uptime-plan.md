# Uptime and alerts (hardening backlog, step 3)

Owner, 2026-11-15: "làm đợt 3". Source: [`2026-11-15-web-app-hardening-backlog.md`](2026-11-15-web-app-hardening-backlog.md),
recommended order item 4 (moved before Lighthouse's budgets: a site that is down is worse than a slow one).

## Why

Two failures nobody would see today:

1. **The site or its database is down.** Sentry catches errors in requests that reach the app, but not a site that
   answers nothing, or a database that refuses every read.
2. **The clock stopped.** Modal is the only scheduler (`packages/engine/modal_app.py`): it calls `/api/cron/cmo` every
   hour (the CMO's loops), `/api/cron/cmo-digest` every hour and `/api/cron/cleanup` every night. If Modal stops, or a
   route keeps failing, the CMO silently stops planning and drafting, and no founder gets an error to report.

## What

| Part | Where | What it does |
|---|---|---|
| `/api/health` | `app/api/health/route.ts`, `lib/ops/health.ts` | 200 `{ok, checks: {web, database}}` when the database answers a one-row read of the public price list (anon key, 3 s timeout); 503 when it does not. Never cached. Says which part is down, never why. Outside the middleware matcher. |
| Cron monitors | `lib/ops/cron-monitor.ts`, the three cron routes | After the caller is authorized, each run checks in with Sentry: `in_progress`, then `ok`, or `error` on a 5xx or a throw. Monitors `cron-cmo`, `cron-cmo-digest`, `cron-cleanup` are created by their first check-in, on Modal's schedules, 10 minutes margin (Modal retries twice, a minute apart). A missed, late or failed run becomes a Sentry issue. |
| Check | `lib/ops/uptime.check.ts` in `check:contracts` | Health answers, the route's 503 and `no-store`, the middleware skip, the check-in statuses, and that each monitor's crontab is the one in `modal_app.py`. |

Without `NEXT_PUBLIC_SENTRY_DSN` (local, CI) the check-ins do nothing.

## For the owner (in Sentry, after the merge and deploy)

These are changes to the Sentry account, so they wait for the owner's go-ahead. The session can make them with the
Sentry tools once asked.

1. **Uptime monitor** on `https://<production domain>/api/health`, every minute, alerting after 3 failures in a row.
2. **One alert rule** for the cron monitors and the uptime monitor, to the owner's email (and Telegram or Slack if one
   is set up).
3. After the first hour on production, check that `cron-cmo` and `cron-cmo-digest` show green check-ins.

## Out of scope

- A check that the Modal `sweep` (every minute, runs the queued jobs) is alive. It does not call the web app; a missed
  sweep shows up as jobs that stay queued. A later step could have the sweep check in with Sentry from Python.
- Status page, on-call rotation.
