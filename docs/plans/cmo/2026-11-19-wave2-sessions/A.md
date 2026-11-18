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

### - [ ] A3. Free reply drafts for paid, a second free scan
- `cmo_job_price('sales_reply_drafts')` → 0 for a paid account (keep it paid-only through `cmo_require_paid`).
- `cmo_first_run_free('sales_scan')`: also true when every earlier non-failed free `sales_scan` of the account ended
  with `output->>'verdict' = 'none'` and there were fewer than 2 of them.
- pgTAP for both. Commit `Wave 2 A3: replies included, one more free scan after none` and push.

### - [ ] A4. Email settings and the log columns
- `profiles.digest_days` and `digest_hour` default 8 (plan's contract); extend `save_cmo_settings` with `p_digest_days`.
- `email_log`: `subject text`, `summary jsonb`, status `skipped`, kinds `digest | weekly | push` (+ old `expiring`);
  allow a `skipped` row with no approvals (`approval_ids` may be empty for it).
- RPC `my_email_log(p_limit int)` for Settings (RLS, newest first, 14 days).
- pgTAP. Dump schema. Commit `Wave 2 A4: email schedule and log` and push. Tell B in its Requests when done.

### - [ ] A5. Annual plan row
Add the `$690 / year` row to `billing_catalog` behind a Creem product id read from an env or a seed the owner fills;
`check:pricing` passes. If the owner has not created the Creem product yet, leave the migration ready and say so in
the PR. Commit `Wave 2 A5: annual plan` and push.

## Requests

(none yet)
