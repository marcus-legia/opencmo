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

- [x] **B0 Shared building blocks (first, push at once).**
  - `cmo_require_paid(p_user)`, with its own SQLSTATE. Map it to 402 and the code `plan_required` in
    `lib/api/errors.ts`.
  - `components/billing/PlanSheet.tsx`, with the plans from the catalogue (no price in code).
  - The `today` contract: the types in `lib/cmo/today.ts` and the block's schema in `lib/screens/dashboard.ts`.
  - pgTAP for the helper.
  - Then write in A's file that B0 has landed.
- [x] **B1 Research note** (below): what the code does now for each item, with `file:line`, what changes, and how it
  is checked.
- [x] **B2 (1.1) Today.**
  - `buildToday` (pure, with unit tests) and the loader in `load.ts`, plus the registry lists and the fixture.
  - The block at the top of the Dashboard, with the queue below it as "Everything waiting".
  - Ranking, the cap of 5, "N of M done", silence at 2 and 7 days, and the connection row only when publishing is
    configured.
  - The first-run rows: "Ready to read" now, and "Rate your first drafts" through A's `rateDraftsPending`. Until A5
    lands, a stub that returns false.
  - e2e at 1280 px and 390 px, and screenshots that you look at.
- [x] **B3 (1.3) Today in the morning email.** The top 3 rows and "N more waiting" in `digest.ts`, with
  `digest.check.ts` cases.
- [x] **B4 Code review of group 1** (plan §7), written under "Reviews".
- [x] **B5 (3.1) The free first run.**
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
- [x] **B6 (3.2) Onboarding shows its work.**
  - Real steps in `cmo_runs.steps`, and Setup shows them live.
  - The three optional questions, saved through `cmo_onboarding_answers`, with a Skip button.
  - Go to the Dashboard when the run ends.
  - e2e with `OPENCMO_AI_FAKE=1`.
- [x] **B7 (3.3) "Used by" on each document** in `BusinessDocs.tsx`.
- [x] **B8 (3.4) `product_events` and the `activation` view.**
  - Triggers on `approvals`, `schedule_slots` and `opportunities`, as their own functions.
  - The table is service-role only.
  - pgTAP as in plan §5.4.
- [x] **B9 Code review of group 3** (plan §7), written under "Reviews".
- [x] **B10 Finish.**
  - Rebase, regenerate `supabase/schema/current.sql`, and run every check of plan §7.
  - Take the screenshots of Today and Setup (1280 px and 390 px, light and dark), look at them, and attach them.
  - Run `/code-review high` on B's whole diff and hand it to the reviewer.

## Research note

B1, written against `main` at `e442855` (the plan's base) on 2026-11-10. What the code did, what changed, how it is
checked.

**Branch.** This session's harness pushes to `claude/pr-186-session-b-0hyo3r`, and draft PR #187 targets
`claude/okara-spec-opencmo-b7qlx2`, so B's commits land in #186 when #187 is merged. B rebases on that branch before
B10.

**1.1 Today.**
- Was: the Dashboard (`components/dashboard/Dashboard.tsx`) opened on the whole queue (`ApprovalQueue`, every waiting
  card, oldest first); "Going out today" read today's slots (`lib/screens/load.ts:250`, `scheduleSlots`).
- Now: `lib/cmo/today.ts` (pure `buildToday`) ranks at most 5 rows; `lib/cmo/today-input.ts` reads waiting cards,
  cards decided since local midnight, failed slots still inside `window_ends_at` with a waiting Retry card, the last
  post per platform (`my_published_items` / `published_items`, 60 days back), tomorrow's slots without a connected
  account (only when `publishAdapter()` is configured, `lib/departments/publish/adapter.ts:12`), the strategy
  document, and the first decided card ever. The Dashboard shows `TodayBlock` above the queue, renamed "Everything
  waiting". A card row opens the card in place (`ApprovalCard`), a chat row focuses the chat and fills the request
  (the founder sends it; nothing is sent from Today).
- "Ready to read" shows while the strategy exists and the founder has never decided a card. "Rate your first drafts"
  uses a stub until A5's `rateDraftsPending` lands (it links to `/app?rate=1`; A was asked to open the sheet there).
- Check: `lib/cmo/today.check.ts` (ranking, cap, thresholds, midnight in two zones, setup row), `screens.check`,
  `e2e/ui-v2-today.spec.ts` (1280 and 390 px, approve the top row → "1 of 2 done today", a 9-day-quiet LinkedIn
  first, screenshots).

**1.3 Morning email.**
- Was: `buildDigest` listed every waiting card.
- Now: `loadDigestInput` also builds Today (same `buildToday`; `today: false` on the Dashboard, which has its own
  block) and `buildDigest` starts with the top 3 rows and "N more waiting", falling back to the old list on a day
  with no rows. Links only open things: a card, an `/app` page, or the chat (`/app?ask=1`). `lib/notify/send.ts` is
  unchanged.
- Check: `lib/cmo/digest.check.ts` (order, cut, empty day, escaping, no deciding link).

**3.1 The free first run.**
- Was: `app/app/page.tsx:37-44` sent an account with no plan and no credits to `/app/billing?start=1`; the onboarding
  route waited up to 15 s for a payment (`paidOrWait`) and answered 402; `cmo_enqueue` charged every plan and draft.
- Now (SQL, `20270114010000`, `20270114020000`):
  - `cmo_paid(user)` (internal: plan on sale or credits left, no ownership check, not granted to founders) and
    `cmo_require_paid(user)` (founder-facing, a founder asks only about themselves) with SQLSTATE `P0402`, mapped to
    402 `plan_required` in `lib/api/errors.ts`. The two are split because `cmo_enqueue` runs inside other users'
    transactions in tests and triggers, where an ownership check answered "Not found" (found by `212_p3_writer_orders`).
  - `cmo_first_run_free(user, kind)`: no plan and no credits, `plan_week` or `post_draft`, no earlier run of the kind
    that is queued, running or done. **Deviation from the plan's "not paid (`is_paid`)":** an account with credits left
    pays as before, so "paid" has one definition everywhere and the older tests of accounts topped up with credits
    keep their meaning. A failed first run is tried again for free (bounded by the daily limits: 5 plans, 10 drafts).
  - `cmo_enqueue`: the free run is priced 0 under the per-user lock (two requests at once make one free run); any
    other priced run of an unpaid account answers `P0402` before "Not enough credits". Runs priced 0 are unchanged.
    The week budget gate (`cmo_runs_budget_gate`) already lets `credits = 0` through.
  - `start_cmo_run`: unpaid onboarding is 2 runs ever (`cmo_free_onboard_runs()`), then `P0402`; paid keeps 5 a day.
- Now (web): the onboarding route drops `paidOrWait`; `/app` sends an account without documents to Setup; the CMO chat
  turn checks `requirePaid` before any model call (`app/api/v1/agent/sessions/[id]/turns/route.ts`, CMO scope only;
  the editor's Assistant keeps its own checks); the chat and Sales "Scan now" show `PlanSheet` on the 402; the daily
  loops skip unpaid accounts (`LoopState.paid`, read in `lib/cmo/schedule.ts`); the copy in plan §5.1 now reads "Your
  first plan and drafts are free. Pick a plan to approve and post them."
- Email verification: the only sign-in is Google OAuth (`components/LoginForm.tsx`), whose accounts carry a verified
  Google email; email/password signup is refused by the `before_user_created` hook (`check:auth-signup`,
  `178_refuse_email_signup`). So no extra wait for a verified email is needed. A new login method must revisit this.
- Waits on A: the refusal of Approve, schedule and "I posted it" for an unpaid account is A3 (`approval_decide`,
  `cmo_post_myself`) and the plan sheet on the card is A's (`components/cards/**`). The e2e for it is written
  (`ui-v2-activation.spec.ts`, "the free first run") and goes green once A3 lands.
- Check: pgTAP `286_cmo_require_paid`, `287_free_first_run` (free once per kind, second charged, paid charged, `source`
  changes nothing, failed first run free again, onboarding 2 then 402); `jobs.check` (no loops when unpaid);
  `handler.check` (P0402 → 402 with the code); e2e "the free first run" and "unpaid onboarding".
- Older pgTAP files that relied on an unpaid account paying from credits (`111`, `112`) now give that account a plan;
  `182` lists the new founder-callable functions.

**3.2 Onboarding shows its work.**
- Was: Setup posted the website and waited on one blank request (`SetupScreen.tsx:54`), then went to the Dashboard.
- Now: `runOnboarding` writes `[{id, status}]` to its run through `cmo_onboard_step` (owner-checked, ids and states
  only; Setup words each step). `GET /api/v1/cmo/onboarding` returns the run, the plan and draft runs started after it,
  the saved answers and the handle the CMO found. Setup polls every 2 s (Realtime was not used: `cmo_runs` is not in
  the publication, and a poll needs no new grant), lists seven steps, and goes to the Dashboard when the drafts end
  (`setupFinished`). Three optional questions save through `cmo_onboarding_answers`: onto `profiles` (four new
  columns with checks) and into the documents the CMO already reads, so no job had to change: the handle into an
  empty `product.x_handle`, the platforms as the first sentence of `content_strategy.cadence`, which the planner's
  rule reads for Threads and LinkedIn (`plan-week.ts:35`). Answers given before the documents exist are applied by
  `runOnboarding` right after it saves them.
- Check: pgTAP `288_onboarding_steps`; `lib/cmo/onboard-status.check.ts`; `e2e/ui-v2-setup.spec.ts` (1280 and 390 px,
  steps in order, answers saved and applied, Skip, the Dashboard with "Ready to read").

**3.3 "Used by".** `BusinessDocs.tsx` names who reads each document. Every job that writes for the founder puts the
four documents in its prompt (`documentsBlock`: plan, drafts, threads, Sales scan and replies, competitor research),
so each says "Planner, Writer, Sales, Research". Check: `ui-v2-pages.spec.ts`.

**3.4 `product_events` and `activation`.** A table with RLS on and no policy, `select, delete` for the service role
only, `unique (kind, ref_id)`, written by five trigger functions (`cmo_runs` onboard done, `approvals` post/reply
approved, `schedule_slots` waiting and published-without-a-post, `content_items` published, `opportunities` replied).
No product function was edited; a failed event write only warns. The `activation` view (security invoker, service
role only) gives per signup day and paid: signups, onboarded, approved within 24 h and the share. Check: pgTAP
`289_product_events`.

## Reviews

Commit hashes are on this branch; it merged #186's branch at `9dcd431` (A's 2.1) after these reviews.

**B4, group 1 (B0, 1.1, 1.3), 2026-11-10, `/code-review high` on `3c23080^..2aab278`.** Ten findings, all fixed in
`228eb2a` except where noted:
1. The email cron read Today as the founder first, failed, then read it again as the service role, and re-read the
   time zone: fixed, `send.ts` passes `asService: true` and `founder.timezone`.
2. `hasPlanOrCredits` read any RPC error as unpaid: already gone in `b2fa289` (3.1 removed it and its callers).
3. An unknown `profiles.timezone` made `Intl` throw and dropped Today: fixed, `safeZone` falls back to UTC (test).
4. A platform with a post already scheduled was called silent: fixed, slots from now to the end of tomorrow mark the
   platform as `upcoming` (test).
5. The email's Today rows were not filtered by the claim: fixed in `buildDigest` (card rows only for cards still in
   `waiting`, the count adjusted; test). The send stays gated on waiting cards: the email tells what waits.
6. The connection row counted intent slots, which need no account: fixed, `mode = 'publish'` only.
7. A card already past `expires_at` ranked as expiring today: fixed (test).
8. Today read its own cards and could list kinds the queue hides: fixed, the Dashboard keeps only cards the queue
   shows. The second approvals read stays (it is small); the email has no queue to reuse.
9. The chat prefill gave up after 80 ms, and the email's chat link carried no request: fixed, it waits up to 2 s and
   the link carries the request (and in `c62ee11` only a request Today itself writes is taken).
10. A failed decision put back the whole old Today: fixed, only its own row and the count.

**B9, group 3 (3.1–3.4), 2026-11-10, `/code-review high` on `b2fa289^..228eb2a`, with the security checklist.**
Ten findings, fixed in `c62ee11` except where noted:
1. An empty Content plan rhythm turned the platforms sentence into `cadence: null`, and every later call added a
   version: fixed with `concat` (pgTAP 288).
2. A failed free first plan could never be retried in v2 (onboarding counted failed plans; loops skip unpaid; chat is
   paid): fixed, reading the site again retries a first plan or draft that failed.
3. Unpaid onboarding counted runs that failed on our side: fixed, only runs that did not fail count (pgTAP 287).
4. A failed run gave the free run back forever: fixed, at most three failures per kind (pgTAP 287).
5. `cmo_enqueue` still used `is_paid` (ownership-checked) for Mode B pricing: fixed, it reads the plan directly.
6. The chat paywall was only on new turns: fixed, `continue` checks it too (`requirePaidForCmoSession`). The tool
   result and approval routes only finish a turn that already passed the check.
7. The cron copied the paid rule into TypeScript and kept half a chunk on an error: fixed, `cmo_paid_users` in SQL,
   and an error counts nobody.
8. `?prompt=` let any link type instructions into the CMO chat: fixed, only Today's own requests are taken (test).
9. `activation` read every earlier signup as never onboarded: fixed, the migration backfills earlier onboardings and
   approvals (paid is the state at migration time; the note says so).
10. A redundant condition in the approve trigger: removed.

Security checklist: no secrets touched; all migrations are new in this PR (`20270114…`); the new table grants
`select, delete` to the service role only and nothing to founders (pgTAP 289); no credits move outside
`credit_hold` (the free run holds nothing); every limit runs before the work it bounds (`requirePaid` before the
turn, `start_cmo_run` before the site is read).
**B10, B's whole diff, 2026-11-10, `/code-review high` on `origin/claude/okara-spec-opencmo-b7qlx2...2d0bff9`.** Ten
findings, fixed in the commit after `2d0bff9` except where noted:
1. Setup could wait forever for a plan in the founder's own Claude (Mode B): fixed, it leaves 2 minutes after the
   documents are saved at most (`SETUP_MAX_WAIT_MS`, check).
2. The email read the 20 oldest waiting cards while Today ranks from 100, so a recent urgent row was dropped: fixed,
   the email reads 100 like Today.
3. Reading the site again queued a draft while the first plan still ran, or after a Mode B plan: fixed, only after a
   finished OpenCMO plan whose draft failed.
4. A handle the founder typed did not replace one the CMO guessed: fixed, a typed handle wins (pgTAP 288).
5. One unreadable chunk of `cmo_paid_users` dropped every founder's loops: fixed, only that chunk waits a day.
6. `/approvals` and `/tool-results` continued a CMO turn without the plan check: fixed, all four turn routes check.
7. Applied answers write document versions as `created_by = 'user'`: kept. They are the founder's own answers, and
   Library then says the founder changed the document, which is true.
8. Today reads waiting cards again next to the queue and the digest: kept for now (one indexed query per load); the
   email needs it on its own, and passing the queue in would split the reader in two. Noted for a later pass.
9. Vietnamese comments next to edited code (`loops.ts`, `pricing.ts`): translated.
10. `/app?paid=1` sent "paid=1" to Setup without checking: fixed, Setup says the payment arrived only when the plan or
    credits are there, and that it is on its way otherwise.

## Checks (B10, 2026-11-10, on the branch after merging #186's head `9dcd431`)

- pgTAP on a reset database: 179 files, 3048 tests, all pass. `supabase db lint --level warning`: no warning in B's
  functions (the four left are `caption_check` from `main` and A's `schedule_pick_time`, `post_proposed_at`,
  `post_proposal_snapshot`).
- `npm run typecheck`; `npm run check:contracts` (with `cmo:eval -- --provider fake`); `NEXT_PUBLIC_OPENCMO_UI=v2 npm
  run build`: pass.
- e2e (`NEXT_PUBLIC_OPENCMO_UI=v2`, desktop project, Chrome, local stack without the clip worker):
  - pass: `ui-v2-today` (3), `ui-v2-setup` (3), `ui-v2-pages` (13, with "Used by"), `ui-v2-activation` "unpaid
    onboarding", "the first week", "/video is hidden";
  - waits on A3: `ui-v2-activation` "the free first run" passes up to Approve (documents, plan and draft with 0
    credits and no hold, a second plan answered 402 `plan_required`) and expects the plan sheet after Approve, which
    is A3's `approval_decide` paywall and the card's sheet;
  - fail before B's change too (`main`'s Today redesign and A's 1.2, not touched by B): `ui-v2-dashboard` "on the
    fixture" (the Writer chip reads "1 waiting", the spec expects "1 waiting on you"), "the phone shows the team list"
    (two regions named "Your team"), "on live rows" (the post card's button is now "Approve for this time"). Written
    to A's requests for the last one.
- Screenshots, looked at: [`screenshots-B/`](screenshots-B/) — Today at 1280 and 390 px in light and dark, and after
  approving the top row ("1 of 2 done today"); Setup working at 1280 px light and 390 px dark, and the website step in
  the other theme at each width.

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
