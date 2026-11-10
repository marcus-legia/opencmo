# Session A: the post card and the voice (1.2, 2.1, 2.2, 2.3)

Plan: [`../2026-11-09-cmo-review-3-plan.md`](../2026-11-09-cmo-review-3-plan.md) §3.2 and §4. Rules: §6 and §7.

Branch: `claude/okara-spec-opencmo-b7qlx2`. Pull before each item, and push after each commit.

**Owns:**
- migrations `20270113010000`–`20270113999999`, and pgTAP tests `276`–`285`;
- these SQL functions: `approval_decide`, `cmo_decide_post`, `cmo_post_myself`, `schedule_propose`,
  `schedule_follow_deliverable`, `correction_from_edits`, `cmo_decide_correction`, and the post card's part of
  `approval_snapshot`. Also the new `cmo_rate_drafts`, `cmo_accept_corrections`, `cmo_edit_correction` and
  `cmo_voice_undo`, and the tables `cmo_draft_ratings` and `cmo_voice_events`;
- `apps/web/components/cards/**`;
- `apps/web/lib/cmo/jobs/classify-edits.ts`, `lib/cmo/jobs/distill-ratings.ts` (new), and `lib/cmo/voice.ts` (new);
- the `distill_ratings` entry in `lib/cmo/jobs/runner.ts` and `packages/contracts/capabilities.json`;
- `apps/web/components/screens/library/LibraryScreen.tsx` (the Voice tab only);
- `apps/web/lib/cmo/skills/no-ai-slop.check.ts`;
- `docs/architecture/approval.md` and `schedule-publish.md`, with their `.html` twins.

**Notes from the build (2026-11-10):**
- 1.2: "no schedule card" still writes an approved `schedule` row for the slot: the firing only posts what
  `schedule_approval_holds` finds approved (A0). Older tests of the schedule-card path set `proposed` to null.
- 2.2: `cmo_accept_corrections` takes the round too, `(p_round, p_ids, p_texts)`, so the rules left unticked are set
  aside in the same transaction and the sheet does not show them again.
- 2.3: the Voice page reads `/api/v1/cmo/voice` (not the screens loader, which is B's `load.ts`). Its parts live in
  `LibraryScreen.tsx`.
- A local Postgres 16 with a pgTAP stand-in ran every test file before each push; CI's Supabase run is the
  authoritative one.

**Waits on:** nothing for A1–A2. A3 waits on B0 (`cmo_require_paid`, the 402 mapping, `PlanSheet.tsx`). A5's Today
row is B's (the request below).

## Todo, in order

- [x] **A0 Research note** (below, before any code): what the code does now for each item, with `file:line`, what
  changes, and how it is checked.
- [x] **A1 (1.2) The post card carries its time.**
  - When the card is raised, the proposal is stored on the item: `body.proposed` = `{platform, at, account_id,
    mode}`, picked by `schedule_pick_time`.
  - The snapshot and hash include it.
  - The card gets the actions `change_time` and `change_account`.
  - On approve, `schedule_propose` makes the slot `waiting` with no card. It still runs `schedule_ready_check` and the
    gap and cap rules. If the time can no longer be used, it falls back to one `schedule` card with the line "The time
    you approved is no longer free. Pick a new one."
  - The card UI shows "Goes out … on X (@handle)", or "Opens X to post at …" when there is no account. It has a time
    picker, the same as Schedule's.
  - `decide_card` (chat and MCP) says that the shown time is approved.
  - Update the docs: `approval.md` and `schedule-publish.md`, and their `.html` twins.
  - pgTAP and e2e as in plan §3.2.
- [x] **A2 Code review of group 1** (plan §7): `/code-review high` on A1's commits and the security checklist. Write
  the outcome under "Reviews".
- [ ] **A3 Paywall on decisions.** Once B0 has landed, call `cmo_require_paid` in `approval_decide` (approve, the
  schedule actions, `change_time`) and in `cmo_post_myself`. Then:
  - the card shows `PlanSheet` on a 402 `plan_required`;
  - the card is put back, and the drafts stay;
  - pgTAP: unpaid approve is refused with the code, and paid is unchanged.
- [x] **A4 (2.1) A reason picked on every draft.**
  - Add the columns `reason_code` and `labelled_by` to `cmo_draft_outcomes`, with a check of the list.
  - Show the chips on Skip, and the optional "What did you fix?" chips on an edited approve.
  - A founder label sets `edit_mode` and `classified_at`. Make the classifier skip those rows.
  - In `correction_from_edits`, two founder labels are enough, and founder skips count too.
  - Add the field to the route zod schema and to `decide.ts`.
  - pgTAP and `jobs.check.ts` as in plan §4.1.
- [x] **A5 (2.2) Rate your first drafts.**
  - Add the table `cmo_draft_ratings`, with RLS, grants and pgTAP.
  - Add `cmo_rate_drafts` (at most 5 rows a round and 1 round a day) and the job `distill_ratings`:
    - Haiku, price 0;
    - `NO_AI_SLOP` embedded and listed in `no-ai-slop.check.ts`;
    - at most 5 rules of under 200 characters each, and the code drops a rule no rating supports;
    - the rules are written as proposed corrections with `source = 'ratings'`.
  - `cmo_accept_corrections` activates the ticked rules in one transaction.
  - The rating sheet lives in `components/cards/` and opens from B's Today row.
  - Export `rateDraftsPending(supabase)` from `lib/cmo/voice.ts`.
  - Tests: an eval fake case, pgTAP and e2e, as in plan §4.2.
- [x] **A6 (2.3) The voice as a page with history and Undo.**
  - Add the table `cmo_voice_events`, and `cmo_edit_correction` and `cmo_voice_undo`.
  - Write events from every rule change, and from a trigger on `save_marketing_document` for `strategy.voice` and
    `avoid`.
  - The Voice tab has three parts: Rules, From your setup, and Learned notes, plus the history with Undo.
  - pgTAP and e2e as in plan §4.3.
- [x] **A7 Code review of group 2** (plan §7), written under "Reviews".
- [ ] **A8 Finish.**
  - Rebase, regenerate `supabase/schema/current.sql`, and run every check of plan §7.
  - Take the screenshots of the post card and the rating sheet, look at them, and attach them.
  - Run `/code-review high` on A's whole diff and hand it to the reviewer.

## Research note

A0, 2026-11-10, against the branch head `f7e48a75` (= `main` `e442855` + the plan).

**1.2, the post card's time.**
- Now: `cmo_decide_post` approves the words; `approval_close` makes the `post` deliverable `decided`;
  `schedule_follow_deliverable` (`current.sql:12057`) calls `schedule_propose` (`:12298`), which picks a time
  (`schedule_pick_time`, `:12236`), inserts a `proposed` slot and raises a `schedule` card (`approval_raise`, `:1931`).
- The firing never posts without the founder: `schedule_claim_due` and `publish_slot_start` check
  `schedule_approval_holds` (`:11693`), an `approvals` row of the slot, `approved`, whose hash equals the slot's
  snapshot now. So "no schedule card" cannot mean "no approval row": the post card's decision writes that row.
- Change: a `BEFORE` trigger on `content_items` stores `body.proposed` when a post enters review (a redraft keeps it);
  `approval_snapshot` puts it, with the handle, in the post card's snapshot; `approval_decide` takes `change_time` and
  `change_account` on a post card (`post_change_proposal`, same limits as `schedule_change`); `schedule_propose` first
  tries `schedule_take_proposal` (gap, cap, `schedule_ready_check`, unique slot), which inserts the slot `waiting`
  with an `approved` schedule row and no card. A time that is gone takes the old path, with the slot's `missed`
  message "The time you approved is no longer free. Pick a new one." `schedule_pick_time` also avoids the times other
  waiting post cards propose. "I posted it" (`cmo_post_myself`) sets `opencmo.posted_self`, so nothing is scheduled.
- Check: pgTAP `276`; `screens.check.ts` (the card contract); e2e `ui-v2-schedule.spec.ts` (approve a post, the slot
  waits at the shown time, it shows on Schedule); old tests that test the schedule card set `proposed` to null.

**2.1, reasons.** `cmo_decide_post` (`:3719`) writes `cmo_draft_outcomes` (skip: no edit mode; approve: version and
similarity, `NO_MEANINGFUL_EDIT` at or above `cmo_as_written()`); the skip reason becomes a voice note.
`classify-edits.ts` labels approves with `classified_at is null` (`cmo_unclassified_outcomes`).
`correction_from_edits` (`:5900`) counts approves only, 3 in 14 days. Change as plan §4.1.

**2.2, ratings.** No table yet. `cmo_corrections` has `rule`, `source_edits`, `edit_mode`, `times`, `status`; a
`source` column is new. The Haiku job goes through `lib/cmo/agents/registry.ts`, price 0 like `classify_edits`.

**2.3, voice page.** `LibraryScreen.tsx:103` shows the voice notes; rules are only cards. `cmo_voice_events` and the
three RPCs are new; the `save_marketing_document` trigger reads `strategy.voice` and `strategy.avoid`.

## Reviews

### Group 1 (A2), 2026-11-10, `f7e48a75..ed968ea8`

`/code-review high`: 10 findings, all fixed. The SQL ones change functions of the same unmerged migration, so they
went in one commit; the web ones in a second.

1. The snapshot read the account's handle live, so a renamed or removed account locked the card ("This card
   changed") → the handle is stored on the proposal; `post_proposal_snapshot` reads the post alone. pgTAP: a renamed
   account keeps the hash.
2. A copy-and-open time approved before the founder connected the account would post in intent mode → fallback card
   "You connected X since you approved it. Check the time and the account."
3. A time the founder picked by hand could be refused by the gap rule at approval → `picked: founder` skips the gap
   (as `schedule_change` does); the cap still holds. pgTAP: a picked hour an hour after another post is kept.
4. The proposal was used again on every later proposal, so later cards said "the time you approved" → used only for the
   post's first slot on the platform. pgTAP: a later card has no error.
5. A failed `schedule_ready_check` was reported as "no longer free" → the card shows the check's own words.
6. The approve toast promised the time even when the server fell back → it says a card asks again if the time was
   taken meanwhile.
7. A redraft that moved the post to another platform kept the old platform's time → a platform change picks again.
   pgTAP: moved to LinkedIn, a LinkedIn time.
8. The meta line read the raw snapshot, not the parsed proposal → one parse for both.
9. Three copies of the platform names → `PLATFORM_LABEL`.
10. `approval_snapshot` called the proposal function twice → once, through a lateral join.

Security checklist (SQL, a route): every new function is `security definer` with `search_path = public` and revoked
from `public, anon, authenticated` (pgTAP 182, the allowlist, stays green); the only door is `approval_decide`, which
checks the owner, the status and the hash before the post branch; `change_time` and `change_account` read the item
and the account by the card's user (another founder's card: "Card not found."); the approved schedule row is written
only inside `schedule_propose`, from the founder's own decision; error text is English. No credits move.

Also fixed while testing: pgTAP 235 relied on heap order for two cards with the same `created_at`; it now sets the
order.

### Group 2 (A7), 2026-11-10, `e0b8e49d..d545d07f`

`/code-review high`: 10 findings, all fixed (one SQL commit, one web commit, as in group 1).

1. A rule left with "Later" stayed proposed and blocked the same words in the next round → a new round sets the older
   rounds' waiting rules aside, and only active rules or this round's block a repeat. pgTAP 278.
2. Undo took no event, so it could revert a change the page never showed → `cmo_voice_undo(p_event)` refuses unless
   that event is still the newest; the page reads again. pgTAP 279.
3. A direct `enqueue_cmo_run('distill_ratings')` started free Haiku runs → refused like the schedule's free jobs.
   pgTAP 278.
4. The Voice page cut active rules at 60 and turned-off rules at 30 events → all active rules (200), and every rule
   that was ever on, from its own events.
5. The CMO chat's strategy saves were labelled "You" (it inserts as the founder, then marks the version `agent`) →
   that update relabels the version's events "Your CMO". pgTAP 279.
6. A chip with an empty `reason` lost its reason → the trimmed reason or the chip's name, never "". pgTAP 277.
7. Undo of a field that had no value removed the key → it is emptied (`""`, `[]`). pgTAP 279.
8. One chip state served both Skip and "What did you fix?" → two states.
9. `cmo_draft_quality_weekly` counted skip chips as edits → its edit modes count approvals only. pgTAP 277.
10. The chip list was typed in three places in TypeScript → the routes and the job read `DRAFT_REASONS`; SQL's list
    is compared by `jobs.check.ts`.

Security checklist (SQL, RLS, routes, a free job): the two new tables have RLS with a select-own policy, `select` for
`authenticated` and full grants for `service_role` only, asserted in pgTAP; every write goes through an
owner-checking RPC (`cmo_rate_drafts`, `cmo_accept_corrections`, `cmo_edit_correction`, `cmo_voice_undo`), all on
the function allowlist (182); the job's two RPCs are service-role only; the free job is reachable only through a
rating round (one a day, five ratings); the founder's notes and the drafts go to the model inside tags with
`escapeForTag`, and the model's rules are kept only when a rating supports them; routes use allowlisted rate limits;
error text is English. No credits move.

### Screenshots (A8, 2026-11-10)

In [`shots-A/`](shots-A/), looked at: the post card with its time ("Goes out Thu 12 Nov, 10:00 on X (@founder)", and
"Opens X to post at …" with no account), the Skip chips, the rating sheet and "Your CMO learned:", at 1280 and 390 px,
light and dark. No Docker here, so they come from a harness that renders the real components with the real
stylesheets (fetch stubbed); the e2e specs (`ui-v2-schedule`, `ui-v2-writer`, `ui-v2-voice`) cover the live path in CI's
e2e run. Seen and kept: the dialog's focus ring when it opens is the shared `v2-dialog` behaviour.

### State at hand-off (2026-11-10)

- Done: A0, A1 + A2, A4–A7. Every push green locally (pgTAP on a local Postgres, typecheck, build, check:contracts,
  `cmo:eval --provider fake`); CI green on the PR through `9dcd4311`.
- Waiting: **A3** (paywall on decisions) waits on B0 (`cmo_require_paid`, the 402 mapping, `PlanSheet.tsx`); none is on
  the branch yet. **A8**'s rebase, schema dump and final `/code-review high` on A's whole diff run after A3.

## Requests

- **From the reviewer (2026-11-10): A3 is unblocked, and it blocks the merge.** Session B worked on its own branch,
  so B0 never reached this one. It was merged in at `45f21c72`. Until A3 lands, an unpaid account on the free first
  run can approve, schedule and mark "I posted it" with no plan, which breaks the plan's §2 decision. B's e2e
  `ui-v2-activation.spec.ts` stays red until then. In order:
  1. A3, as B's note below says: `perform public.cmo_require_paid(v_user)` at the top of `approval_decide` (approve,
     the schedule actions, `change_time`, `change_account`) and `cmo_post_myself`, in a new migration
     `20270113050000_*`. Use the internal `cmo_paid` / `cmo_plan_required` where the caller is not the user. The card
     opens `PlanSheet` when `isPlanRequired(error)`. pgTAP: unpaid is refused with `P0402`; paid is unchanged; skip
     and dismiss stay free (deciding not to post costs nothing).
  2. B's two requests below: open the rating sheet from `/app?rate=1`, and update `e2e/ui-v2-dashboard.spec.ts` for
     "Approve for this time".
  3. CodeQL thread on PR #186 (`jobs.check.ts:632`, "replaces only the first occurrence"): use
     `r.label.replaceAll("'", "''")`, then resolve the thread.
  4. A8: rebase, regenerate `supabase/schema/current.sql` on a reset database, run the checks, run `/code-review high`
     on A's whole diff, and write it up under "Reviews".

- **From B (2026-11-10): B0 has landed** on `claude/pr-186-session-b-0hyo3r` (to be merged into this PR's branch).
  - SQL: `public.cmo_require_paid(p_user uuid)` (migration `20270114010000_cmo_require_paid.sql`, pgTAP `286`). Paid
    means a plan on sale (`is_paid`) or credits left. It raises SQLSTATE `P0402`; call it with `perform` at the top of
    `approval_decide` (approve, schedule, `change_time`) and `cmo_post_myself`, before any other write.
  - HTTP: `lib/api/errors.ts` maps `P0402` to 402 with `detail = { code: "plan_required", message }`.
  - Client: `components/billing/PlanSheet.tsx` exports `PlanSheet` (`open`, `onClose`, `action`) and
    `isPlanRequired(error)`; show the sheet when `isPlanRequired` is true instead of an error line. `lib/plan-offer.ts`
    holds the same helper for code outside components.
  - Server: `requirePaid(supabase, userId)` in `lib/paid-first.ts` for a route that checks before work.
  - In SQL that already trusts the user (a trigger, a function called for another account), use the internal
    `public.cmo_paid(user)` and `perform public.cmo_plan_required()`: `cmo_require_paid` checks that the caller asks
    about themselves and answers "Not found" otherwise (B5, `20270114020000`).
  - B's e2e "the free first run" (`e2e/ui-v2-activation.spec.ts`) presses Approve on an unpaid account's post card and
    expects `plan-sheet`; it goes green once A3 and the card's sheet land.
  - Today's "Rate your first drafts" row links to `/app?rate=1`. Please open the rating sheet from that query on the
    Dashboard, or tell B the URL you want and B changes the link.
- **From B (2026-11-10):** `e2e/ui-v2-dashboard.spec.ts` "on live rows" clicks `Approve` (exact) on a post card,
  which is now "Approve for this time" after 1.2; B's own specs match `/^Approve( for this time)?$/`. The spec is in
  B's dashboard area but the label is yours: please update it with your card change, or tell B to.
