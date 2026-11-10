# Session B: Today and the free first run (1.1, 1.3, 3.1–3.4)

Plan: [`../2026-11-09-cmo-review-3-plan.md`](../2026-11-09-cmo-review-3-plan.md) §3.1, §3.3 and §5. Rules: §6 and §7.

Branch: `claude/okara-spec-opencmo-b7qlx2`. Pull before each item, and push after each commit.

**Owns:**
- migrations `20270114010000`–`20270114999999`, and pgTAP tests `286`–`295`;
- these SQL functions and tables: `cmo_enqueue`, `start_cmo_run`, `cmo_first_run_free`, `cmo_require_paid`,
  `cmo_onboarding_answers`, `product_events`, its triggers and the `activation` view;
- `apps/web/lib/cmo/today.ts` (new), `lib/cmo/digest.ts`, `lib/cmo/onboard.ts`, `lib/cmo/loops.ts`,
  `lib/cmo/schedule.ts`, `lib/paid-first.ts` and `lib/api/errors.ts`;
- `apps/web/lib/screens/dashboard.ts`, `load.ts`, `registry.ts` and `fixtures/dashboard.ts`;
- `apps/web/components/dashboard/**`;
- `components/billing/PlanSheet.tsx` (new);
- `components/screens/setup/**` and `components/screens/library/BusinessDocs.tsx`;
- `app/app/page.tsx` and `app/api/v1/cmo/onboarding/route.ts`;
- the 402 lines in the chat turn and the Sales scan;
- the landing, billing and `llms.txt` copy listed in plan §5.1.

**Waits on:** nothing. A waits on B0.

## Todo, in order

- [ ] **B0 Shared building blocks (first, push at once).**
  - `cmo_require_paid(p_user)`, with its own SQLSTATE. Map it to 402 and the code `plan_required` in
    `lib/api/errors.ts`.
  - `components/billing/PlanSheet.tsx`, with the plans from the catalogue (no price in code).
  - The `today` contract: the types in `lib/cmo/today.ts` and the block's schema in `lib/screens/dashboard.ts`.
  - pgTAP for the helper.
  - Then write in A's file that B0 has landed.
- [ ] **B1 Research note** (below): what the code does now for each item, with `file:line`, what changes, and how it
  is checked.
- [ ] **B2 (1.1) Today.**
  - `buildToday` (pure, with unit tests) and the loader in `load.ts`, plus the registry lists and the fixture.
  - The block at the top of the Dashboard, with the queue below it as "Everything waiting".
  - Ranking, the cap of 5, "N of M done", silence at 2 and 7 days, and the connection row only when publishing is
    configured.
  - The first-run rows: "Ready to read" now, and "Rate your first drafts" through A's `rateDraftsPending`. Until A5
    lands, a stub that returns false.
  - e2e at 1280 px and 390 px, and screenshots that you look at.
- [ ] **B3 (1.3) Today in the morning email.** The top 3 rows and "N more waiting" in `digest.ts`, with
  `digest.check.ts` cases.
- [ ] **B4 Code review of group 1** (plan §7), written under "Reviews".
- [ ] **B5 (3.1) The free first run.**
  - `cmo_first_run_free`. The rule reads history, never `input.source`.
  - The price-0 path in `cmo_enqueue`, and the budget gate lets it through.
  - Unpaid onboarding: 2 runs ever.
  - Remove `paidOrWait`, and change the redirect in `app/app/page.tsx` to go to Setup.
  - The paywall:
    - a 402 `plan_required` on the chat turn, Sales scan, a second `plan_week` and a second onboarding;
    - `PlanSheet` shown on each.
  - The crons skip unpaid accounts.
  - The copy in plan §5.1, so the landing says what is true.
  - Find out how each login method verifies the email before building. If one does not, the free run waits for a
    verified email.
  - pgTAP and e2e as in plan §5.1.
- [ ] **B6 (3.2) Onboarding shows its work.**
  - Real steps in `cmo_runs.steps`, and Setup shows them live.
  - The three optional questions, saved through `cmo_onboarding_answers`, with a Skip button.
  - Go to the Dashboard when the run ends.
  - e2e with `OPENCMO_AI_FAKE=1`.
- [ ] **B7 (3.3) "Used by" on each document** in `BusinessDocs.tsx`.
- [ ] **B8 (3.4) `product_events` and the `activation` view.**
  - Triggers on `approvals`, `schedule_slots` and `opportunities`, as their own functions.
  - The table is service-role only.
  - pgTAP as in plan §5.4.
- [ ] **B9 Code review of group 3** (plan §7), written under "Reviews".
- [ ] **B10 Finish.**
  - Rebase, regenerate `supabase/schema/current.sql`, and run every check of plan §7.
  - Take the screenshots of Today and Setup (1280 px and 390 px, light and dark), look at them, and attach them.
  - Run `/code-review high` on B's whole diff and hand it to the reviewer.

## Research note

(B1 goes here.)

## Reviews

(One entry per `/code-review` run: date, commit range, findings, what was done with each.)

## Requests

- **From A:** B2 calls `rateDraftsPending(supabase)` from `lib/cmo/voice.ts` for the "Rate your first drafts" row.
  A exports it in A5. Until then, use a stub.
- **From A (2026-11-10, A5 landed in `2be24040`):**
  - `rateDraftsPending(supabase)` is in `lib/cmo/voice.ts` (true while a post card waits and the founder never rated a
    round). The row opens `<RatingSheet open onClose={…} />` from `components/cards/RatingSheet.tsx`; nothing else to
    pass. The Voice tab also opens it ("Rate your drafts"), so the e2e does not wait on Today.
  - "N of M done": a post card that carried its time (1.2) writes an `approvals` row of kind `schedule` that is
    **created already approved** (`created_at = decided_at`, never `waiting`). It is not a card the founder saw; count
    only rows that were `waiting` (or count the post card alone).
  - `product_events` `schedule` (a slot made `waiting`): since 1.2 the slot is **inserted** as `waiting` by
    `schedule_take_proposal`, not updated to it. The trigger needs `after insert or update of status`.
  - A changed three functions outside both lists, so they are not redefined from an older copy: `cmo_job_daily_limit`
    (adds `distill_ratings`, 2 a day), the `cmo_runs_kind_check` constraint (adds `distill_ratings`) and
    `approvals_sync` (rules from ratings raise no card). If B0 or 3.1 redefines `cmo_enqueue`, `distill_ratings` must
    stay priced 0 (it is part of the first run, free for unpaid accounts).
  - A3 waits on B0: `cmo_require_paid` and the 402 `plan_required` mapping. Tell A in `A-post-voice.md` → Requests when
    they are pushed.
