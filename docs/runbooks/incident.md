# Incident runbook

For the owner, when something is broken for founders. One page on purpose: read it top to bottom during an incident.
Written in web hardening round 4 (2026-11-17).

## How you find out

| Signal | What it means | Where |
|---|---|---|
| Sentry email "new issue" with `founder-failure` in its fingerprint | A new group of founder failures, or of uploads published with a fallback, appeared. One issue per group: later hours add events, not emails. Stuck work sends an event every hour while it stays stuck, so resolving its issue before the row is fixed reopens it. | Sentry → Issues, filter `alert:founder-failure` |
| Sentry cron monitor `cron-cmo`, `cron-cmo-digest`, `cron-cleanup` or `cron-failures` missed or failed | Modal's clock stopped, or a cron route keeps failing: Sales scans, planning and drafting stop, digests stop | Sentry → Crons; Modal → app → logs |
| Sentry uptime monitor on `/api/health` | The web app or the database does not answer | Sentry → Uptime; Vercel → Deployments |
| `/app/settings/failures` | Everything that failed, got stuck or fell back for founders in the last 7, 30 or 90 days, grouped so one bug is one row | The app, signed in as an owner |
| A founder's email to `support@ferreto.io` | Often the first signal for something that does not end `failed` | Your inbox |

A failure with a clean message (a job or run that ends `failed`) never reaches Sentry as an exception: the hourly alert
(`/api/cron/failures`) is what turns it into an issue. Silent fallbacks (a Scribe failure, a missing face detector)
show as warnings, on the page and as Sentry `warning` events.

## The first ten minutes

1. **Look at the size.** `/app/settings/failures`: how many founders, since when, which source. One founder is a
   support case; several in an hour is an incident.
2. **Was it a deploy?** Compare the first failure's time with Vercel → Deployments and the last `modal deploy`.
3. **Roll the web back** if a web deploy started it: Vercel → Deployments → the last good one → *Instant Rollback*.
   Seconds, no build.
4. **Roll the worker back** if a worker deploy started it: check out the previous commit and `modal deploy
   packages/engine/modal_app.py` from it. Jobs in flight are requeued by their lease.
5. **Never roll a migration back.** Production has applied it, and `supabase db push` never runs a version twice.
   Fix forward with a new migration (`.claude/skills/supabase-migrations`). If a migration broke the web, roll the web
   back to a build that works with the new schema, or ship a fix.
6. **Stop the bleeding** if the job engine itself is doing damage (bad drafts, a provider failing every run): set
   `OPENCMO_CMO_PAUSED=1` in Vercel and redeploy. The jobs stop for every founder within one sweep and their work is
   kept (`lib/cmo/pause.ts`). Unset it to resume. The Costs page's Live switches show which outbound channels are on.

## Telling founders

- Write from `support@ferreto.io` to the founders it hit (the failures page gives their ids; look the emails up in
  Supabase). Say what broke, what you did, and whether they need to do anything. No blame on a provider by name.
- **Credits:** work that ends `failed` gives its held credits back by itself (`credit_refund` from the job, run or
  task). Check the founder's ledger first. Work still holding credits that will not finish can be refunded by hand in
  the SQL editor with `refund_job('<job id>', 'Refund: incident <date>')` or `credit_refund(...)`, which only ever
  return what is still held. There is no function to grant credits beyond that: a goodwill grant needs its own
  reviewed migration, never an `insert` into the ledger by hand.

## Postmortem (within two days)

Copy into `docs/incidents/<YYYY-MM-DD>-<short-name>.md`.

```markdown
# <What broke, in one line>

- **When:** <start> to <end> (UTC). Found at <time> by <signal>.
- **Who it hit:** <n> founders, <n> jobs/runs/posts. Credits returned: <n>.
- **What happened:** <three or four sentences, plain>.
- **Why:** <the root cause, and why nothing caught it earlier>.
- **What we did:** <rollback, fix, the commits>.
- **What changes so it does not happen again:** <a test, a check, an alert; each with a PR or an issue>.
```
