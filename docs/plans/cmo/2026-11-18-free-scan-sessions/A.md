# Session A — SQL and jobs

Plan: [`../2026-11-18-free-scan-plan.md`](../2026-11-18-free-scan-plan.md). Branch `claude/free-scan`.
Read the plan's Global constraints and shared contract first. Load the `supabase-migrations` skill before writing SQL.

**Owns:** new migrations `supabase/migrations/2027013101000*_free_scan*.sql`, `supabase/tests/326_free_scan*.test.sql` (next free number),
`supabase/schema/current.sql` (dump), `apps/web/lib/cmo/jobs/types.ts` (the contract block), `sales-scan.ts`,
new `sales-reply-drafts.ts`, the job registry/runner entries for the new kind, `jobs/progress.ts` (price label),
`jobs/start.ts`, `apps/web/lib/cmo/onboard.ts`, `store.ts` / `memory-store.ts` (only what the new job needs),
`jobs/eval/cases/sales.ts`.

## Tasks

### - [ ] A1. The contract (push first: B and C wait on it)

- Add `SalesScanVerdict` and `SalesScanOutput` to `lib/cmo/jobs/types.ts` exactly as in the plan; add
  `"sales_reply_drafts"` to the job kind union.
- `sales-scan.ts` returns a `SalesScanOutput` on every path (the two early "No conversations worth joining today"
  returns at about lines 523 and 550 included): `queries` = the search lines it built, `scanned` = threads after the
  filters, `verdict` = `cards > 0 ? "found" : "none"`, `free` = false for now.
- `npm run typecheck`. Commit `Free scan A1: the scan's output contract` and push.

### - [ ] A2. SQL: the free scan and the new kind

pgTAP first (count as you write):
- an unpaid account's first `sales_scan` through `cmo_enqueue` is priced 0 and holds nothing;
- the second is refused with `cmo_require_paid`'s 402 message; a failed first gives the free one back (at most twice
  more), a queued or done one does not;
- a paid account's `sales_scan` still costs 5 and holds 5;
- `sales_reply_drafts` exists in `cmo_runs_kind_check`, costs 1, has a daily limit of 5, and an unpaid account gets the 402;
- `plan_week` / `post_draft` free runs behave as before (rerun the existing test file).

Migration: `create or replace cmo_first_run_free` from its body in `current.sql`, `p_kind in ('plan_week',
'post_draft', 'sales_scan')`; extend `cmo_runs_kind_check`, `cmo_job_price` and `cmo_job_daily_limit` for
`sales_reply_drafts` (copy their current bodies from `current.sql`, change only those lines). Dump the schema.
`npm run db:reset && npm run db:test` green. Commit `Free scan A2: the first scan is free; reply drafts job kind` and push.

### - [ ] A3. A free scan writes no drafts

- The scan knows it is the free one from the run itself: `run.credits === 0` and the account is unpaid (read through
  the store with the service role, `cmo_paid`). Never from `input`.
- Free: skip the `draft_reply` step; save the non-skip cards with `reply: ""` (today they are dropped at about line 723
  when the reply is empty: keep them when free). `output.free = true`.
- Paid: unchanged.
- Eval (`jobs/eval/cases/sales.ts`): one case for a free run (cards saved, no reply text, no `draft_reply` step) and
  the existing paid case still passes. Run `npm run agent:eval -- --provider fake` for the Sales cases, or the sales
  eval script the case file names.
- Commit `Free scan A3: a free scan finds and scores, it does not draft` and push.

### - [ ] A4. Onboarding queues the scan

- In `runOnboarding` (`lib/cmo/onboard.ts`), after the documents are saved and before `startFirstWeek`, queue
  `sales_scan` with `{ source: "onboarding" }` when the founder has no `sales_scan` run that is not failed. Kick it
  first (`kickCmoQueue`) so it runs before the plan.
- `startCmoRun`'s 503 when the social reader is not set up must not fail onboarding: catch, log, go on (the screen then
  shows Sales as not set up, as today).
- Return `firstScan: boolean` next to `firstWeek` so Setup can wait on it (tell B in its **Requests** if the shape changes).
- Check the onboarding route's time budget (`ROUTE_MS`): the scan goes through the queue, not inline.
- Commit `Free scan A4: onboarding starts the free scan` and push.

### - [ ] A5. `sales_reply_drafts`

- Move the drafting part of `sales-scan.ts` (the `draft_reply` think call, `replyProblems` check, mention budget) into a
  function both jobs call; the scan's behaviour for paid runs stays byte-for-byte the same prompt.
- The new job loads the founder's `in_review` opportunities with `reply = ''` and `rule <> 'skip'` (newest 10), reads
  the community rules again only when the cache is older than 7 days, drafts, checks, and saves each reply through an
  RPC (add one to A2's migration in a new migration file if none fits: `cmo_save_opportunity_reply(p_id, p_reply, p_gen)`
  owned by the service role, with its pgTAP).
- Zero cards to draft: done, refund.
- Eval case with the fake provider. Commit `Free scan A5: write the replies after paying` and push.

## Requests

(none yet)
