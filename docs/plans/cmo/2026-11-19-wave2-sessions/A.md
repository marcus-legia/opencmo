# Session A — SQL and billing

Plan: [`../2026-11-19-wave2-plan.md`](../2026-11-19-wave2-plan.md). Branch `claude/launch`. Load the
`supabase-migrations` skill before SQL. Migrations from `20270131020000`, pgTAP from `329_`.

**Owns:** new migrations and pgTAP files, `supabase/schema/current.sql`, new `apps/web/lib/billing/usage.ts`
(+ `.check.ts`), `apps/web/lib/billing-catalog.ts`, price checks in `apps/web/lib/cmo/jobs/start.ts`.

## Tasks

### - [x] A1. Contract (push first)
Create `lib/billing/usage.ts` with `PlanUsage` exactly as in the plan and a `parsePlanUsage(row)` helper with its
check. Typecheck. Commit `Wave 2 A1: plan usage contract` and push.

### - [x] A2. `plan_usage()` and the pause at 100%
- RPC `plan_usage()` (security definer, `require_user()`): `used` = credits debited to the founder in the current
  period from `credit_ledger` (holds settled or held, refunds subtracted), `allowance` = the plan's
  `billing_catalog.credits` (yearly plans: per month), `resetsAt` = the next period start from the subscription,
  `paused` = used >= allowance. Free accounts: `plan = 'free'`, allowance 0, never paused (their free runs cost 0).
- `cmo_enqueue`: a paid account whose usage is paused gets a new error with the reset date ("You used this month's
  allowance. New scans start again on 18 Dec."). Only `sales_scan` and research jobs pause; drafts of work the
  founder already has do not.
- pgTAP: usage after a hold, a settle and a refund; pause at 100% refuses `sales_scan` with the message; free account.
Commit `Wave 2 A2: plan usage and the pause` and push.

### - [x] A3. Free reply drafts for paid, a second free scan
- `cmo_job_price('sales_reply_drafts')` → 0 for a paid account (keep it paid-only through `cmo_require_paid`).
- `cmo_first_run_free('sales_scan')`: also true when every earlier non-failed free `sales_scan` of the account ended
  with `output->>'verdict' = 'none'` and there were fewer than 2 of them.
- pgTAP for both. Commit `Wave 2 A3: replies included, one more free scan after none` and push.

### - [x] A4. Email settings and the log columns
- `profiles.digest_days` and `digest_hour` default 8 (plan's contract); extend `save_cmo_settings` with `p_digest_days`.
- `email_log`: `subject text`, `summary jsonb`, status `skipped`, kinds `digest | weekly | push` (+ old `expiring`);
  allow a `skipped` row with no approvals (`approval_ids` may be empty for it).
- RPC `my_email_log(p_limit int)` for Settings (RLS, newest first, 14 days).
- pgTAP. Dump schema. Commit `Wave 2 A4: email schedule and log` and push. Tell B in its Requests when done.

### - [x] A5. Annual plan row
Add the `$690 / year` row to `billing_catalog` behind a Creem product id read from an env or a seed the owner fills;
`check:pricing` passes. If the owner has not created the Creem product yet, leave the migration ready and say so in
the PR. Commit `Wave 2 A5: annual plan` and push.

### - [x] A6. A credit pack lifts the pause (owner, 2026-11-19)
A pack paid this period adds its credits (net of a refund or dispute) to this period's allowance in `plan_usage_for`.
pgTAP 333.

### - [x] A7. Switch to annual (owner, 2026-11-19, C's request)
`billing_switch_target(p_slug)` (own subscription, live monthly, annual product on sale) and
`POST /api/v1/billing/switch` `{ product: "annual" }` → Creem `POST /v1/subscriptions/{id}/upgrade`
(`proration-charge-immediately`). The existing webhook follows. pgTAP 333.

## Requests

- **To B and C (A1, A2 done):** `PlanUsage` / `parsePlanUsage` / `FREE_USAGE` are in `lib/billing/usage.ts`; the RPC is
  `supabase.rpc("plan_usage")` (one row, snake_case: `plan, interval, used, allowance, percent, resets_at, paused`;
  pass it to `parsePlanUsage`). A paused scan fails with P0001 "You used this month's allowance. New scans start again
  on 18 Dec.", a plain 400-class message the Sales card can show as is.
- **To C (A3 done):** `JOB_PRICES.sales_reply_drafts` is now 0 and the run holds nothing; the Write replies button should
  show no price (C2). A free account still gets the 402 plan sheet from it.
- **To B (A4 done, for B2/B3):** `email_log_claim(p_user, p_kind, p_approval_ids, p_subject, p_summary)`: kinds
  `digest | weekly | push`; a digest or weekly email may be claimed with `'{}'` (follow-ups only); a push needs at least
  one waiting card and is claimed once per card; `expiring` now returns no row (no error), so the old cron path sends
  nothing until B3 deletes it. Digest and weekly claims return nothing when the founder unsubscribed or
  `profiles.digest_days = 'off'` (the weekday/Monday choice is the cron's, B2). `email_log_skip(p_user, 'digest',
  p_summary)` logs a skipped day (once a day; a later claim that day returns nothing). `summary` is a JSON object under
  4 KB; `subject` up to 200 characters.
- **To C (A4 done, for C3):** `my_email_log(p_limit)` (1–100) returns the founder's sent and skipped emails of the
  last 14 days, newest first: `id, kind, day, status, subject, summary, created_at, sent_at`.
  `save_cmo_settings` takes `p_digest_days` (`weekdays | daily | monday | off`; null keeps it) and returns
  `digest_days`; `profiles.digest_days` is readable by the founder. `app/api/v1/cmo/settings/route.ts` does not pass
  it yet.
- **To the owner (A5 done, needs you):** create the live Creem product "Ferreto Annual", $690, recurring every year,
  then run `select public.billing_catalog_put_annual('prod_…');` in the production SQL editor. It lists the row as slug
  `annual` (plan `creator`, the monthly plan's credits each month) and takes any older annual product off sale without
  deleting it. Until then the annual plan shows no price and cannot be bought, as before.
- **To A, from C (C1):** Billing has no "Switch to annual" yet. `/api/v1/billing/checkout` refuses a plan for a paid
  account (a second checkout would be a second subscription), so switching needs a route that calls Creem's
  `POST /v1/subscriptions/{id}/upgrade` with the `annual` product, and the webhook path that follows (allowance by the
  new product in `plan_usage`, the grant on its first `subscription.paid`). If you add it (say `POST
  /api/v1/billing/switch` with `{ product: "annual" }`), tell C and the button goes on the Billing card. Also for the
  owner: credit packs are still sold on Billing, but a pack does not lift the fair-use pause, which is measured against
  the allowance.

- **To C (A6, A7 done):** `POST /api/v1/billing/switch` with `{ "product": "annual" }` answers `{ ok: true }` once Creem
  accepted the upgrade; the plan changes when the webhook arrives (seconds), so show "Switching…" and reload the
  usage. Errors come as plain messages: 422/400 "The annual plan is not on sale right now." or "You are already on the
  annual plan.", 404 "You have no plan to switch.", and "Your plan cannot be switched right now. Open Manage billing…"
  for a trial, a failed card or a scheduled cancel. Show the button only to a paid monthly founder while the annual row
  is on sale. Say before the click that Creem charges the prorated difference now. A pack now raises this period's
  allowance (the bar's `allowance` includes it): the pack card can say "adds N credits to this month's allowance".
- **To the owner (A7):** try the switch once with a Creem test subscription before launch (test key, `creem listen`
  forwarding `subscription.update` and `subscription.paid`), and check that the account shows the annual plan with the
  monthly credits granted.
