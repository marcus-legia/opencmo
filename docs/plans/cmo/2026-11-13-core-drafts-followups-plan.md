# Daily core drafts: what is left before a founder's first week

**Goal:** a founder who turns on three platforms gets a post every morning, approves it once, and it goes out on all
three, with nothing in the app that charges for a dead end or counts a posted post as not posted.

**Why now:** [`2026-11-12-daily-core-drafts-plan.md`](2026-11-12-daily-core-drafts-plan.md) is built (PR #204) and its
whole-branch review is done. Five things were left open in that PR. This plan closes the four that code can close and
prepares the one only the owner can do (posting from real accounts).

**Branch and PR:** `claude/stoic-planck-zlphv6`, one PR, stacked on `claude/social-media-autopilot-issue-d7117d`
(#204) until that merges. Three sessions work on it:
[`2026-11-13-core-drafts-followups-sessions/`](2026-11-13-core-drafts-followups-sessions/README.md).

## 1. What is open, and what each costs a founder

| # | Open | What the founder meets | In this plan |
|---|---|---|---|
| 1 | A post with one failed platform never becomes `published` | Two platforms posted, one failed and its card is ignored: the calendar and Analytics count the post as not posted. "4 posts this week" when 6 went out. | Task 2 |
| 2 | No test walks the main flow | The promise "one card a day, approve once, out on every platform" is checked only piece by piece. The worst defect of the review (a core post went out on one platform) is the kind such a test catches. | Task 1 |
| 3 | Writer still offers "Write a slideshow" | The founder pays 1 credit for slide text that nothing builds any more (the CMO-built slideshow was removed, D7). | Task 4 |
| 4 | Photos of an abandoned photo post stay in Storage | They count toward the plan's storage with no way to remove them. A free founder reaches the limit and cannot see why. | Task 3 |
| 5 | Nothing was tried on a real account | A Threads chain, X's "Post as a thread" and a TikTok photo post are built from Zernio's documents only. If a field is wrong the founder approves a post that then fails after they left. | Task 5 (prepares it; the owner runs it) |

## 2. Decisions

| # | Decision | Who |
|---|---|---|
| F1 | **A post is `published` when its first platform posts.** The other platforms keep their slots and post at their own times; a failed one keeps its Retry card. The founder's own "I posted it" on the post card still stops everything, as it says. This replaces "published when the last open slot is" (`post_slots_open`, review fix 1), which left a post `approved` for ever behind one ignored failure. | **decided: kept** (owner left it to the agent, 2026-11-13) |
| F2 | **"Write a slideshow" and the `write_slides` job are removed.** Slideshows already made still open and post. A photo post with a caption is what replaces it (D7). | recommended here; **owner to confirm on the PR** |
| F3 | **A photo draft untouched for 7 days is closed and its photos are deleted.** Starting a photo post again deletes the photos of the draft it empties. | recommended here |
| F4 | **X stays at 4,000 characters.** A core post is 3,000 anyway; nobody has asked for longer. | not in this plan |

## Global constraints

- English in every user-facing string, SQL `raise exception` and comment.
- Every write goes through an ownership-checking RPC; money only through `credit_hold` / `credit_settle` /
  `credit_refund`. A queued run that is removed gets its hold back.
- Never edit a migration of #204 (`2027012000…` up to `20270120070000`): write a new one. Numbers are in the sessions'
  README. Every migration has a pgTAP test; regenerate `supabase/schema/current.sql` after it.
- Autopilot rules of `CLAUDE.md` are untouched. Nothing here posts for the founder.
- The cloud sessions cannot pull the Supabase image. Follow `.claude/skills/supabase-migrations` ("Running the database
  locally"): run what you can, say in your session file what you could not run, and let CI's `database (Supabase)` job
  be the proof. CI does not run the Playwright suite that needs Supabase.

## Review focus

1. **Three platforms, the middle one fails.** X posts, LinkedIn fails, Threads posts an hour later: the post is
   `published` after X, Threads still posts, LinkedIn keeps its Retry card, and a Retry after its window still gets a
   new time. Test in Task 2.
2. **"I posted it" still stops everything.** Marked posted by hand on the post card: every waiting slot is cancelled.
   Test in Task 2.
3. **A slides run in flight when the job is removed.** A queued `write_slides` run is refunded once, not twice; an old
   slideshow still opens. Test in Task 4.
4. **A draft the founder is working on is never swept.** Only drafts untouched for 7 days; a scheduled photo post's
   photos are never deleted. Test in Task 3.

---

## 3. Tasks

### Task 1: The main flow, tested end to end (Session A)

**Files:** create `supabase/tests/312_core_draft_flow.test.sql`; modify `apps/web/lib/cmo/jobs/jobs.check.ts`; create
`apps/web/e2e/ui-v2-core-drafts.spec.ts`; modify `apps/web/e2e/ui-v2-seed.ts` only by adding a seed function; add a
step to `apps/web/lib/screens/p6-acceptance.e2e.ts`.

Three layers, because only the first two run in CI:

- [x] **Step 1, pgTAP (runs in CI):** `312_core_draft_flow`. One founder, plan X 1 + Threads 1 + LinkedIn 1 saved with
  `save_posting_plan`, X and Threads connected. `cmo_plan_week` with one post item → the item's `targets` are the
  three platforms. `cmo_save_draft` → one card, `kind = 'post'`. `approval_decide(card, 'approve')` as the founder →
  three slots: X and Threads `publish`, LinkedIn `intent`; the proposed platform's slot is `waiting` with no schedule
  card, the other two have a card each. Approve both. `publish_status` each → all three `published`. Also: the same
  flow with no account at all → three `intent` slots and nothing errors.
- [x] **Step 2, job check (runs in CI):** in `jobs.check.ts`, a memory-store week with plan X 1 + Threads 1 +
  LinkedIn 1 → 7 post items each with three targets, and one cron day queues **one** `post_draft` run for the day's
  item (not three).
- [x] **Step 3, Playwright (local stack only):** `ui-v2-core-drafts.spec.ts`: the planner shows seven rows with a
  logo each and saves a change; the Feed row of a three-target post reads "Post for 3 platforms" and its card lists
  three chips; Approve gives the three schedule cards; the icon next to Refresh opens the calendar at the planner. Run
  it if your environment has the stack; if not, say so in `A.md` and in the PR, and do not tick the box as run.
- [x] **Step 4:** the Phase A step in `p6-acceptance.e2e.ts` ("one cron day, one card, three schedule cards").
- [x] **Step 5: Commit** `Tests: the daily core draft, from the plan to three platforms`.

### Task 2: A post is published when its first platform posts (Session B)

**Files:** create `supabase/migrations/20270121010000_post_published_first.sql`,
`supabase/tests/309_post_published_first.test.sql`; modify `supabase/tests/308_review_fixes.test.sql` (the cases that
assert the old rule).

- `publish_status` (published) and `schedule_mark_posted` mark the content item `published` at once, with the
  transaction flag `opencmo.slot_published = 'on'` set first.
- `schedule_follow_content` does nothing for a post when that flag is on (a slot posted; nobody posted by hand), and
  cancels the waiting slots as today when it is off ("I posted it" on the post card, `cmo_mark_posted`).
- `schedule_propose` and `schedule_take_proposal` read the post with `status in ('approved', 'published')` when the
  deliverable already has a slot, so a missed or expired slot of a published post still gets a new time.
- Drop `post_slots_open` and the trigger `schedule_slots_settle_post` (review fix 1): the new rule makes them dead.
- [x] **Step 1: Failing pgTAP** `309`: Review focus 1 and 2, plus: a single-platform post behaves as before.
- [x] **Step 2: Implement**, change `308`'s cases to the new rule, dump the schema.
- [x] **Step 3: Commit** `Posts: published when the first platform posts; the others keep their slots`.

### Task 3: Photo drafts are cleaned up (Session B)

**Files:** create `supabase/migrations/20270121020000_photo_draft_cleanup.sql`,
`supabase/tests/310_photo_draft_cleanup.test.sql`; modify `apps/web/app/api/cron/cleanup/route.ts` (one call).

- `photo_draft_release(p_post uuid)` (internal): queues the draft's objects of the `photos` bucket in
  `storage_deletions`; never an object a `scheduled` post lists.
- `photo_post_create` calls it for the draft it empties; `photo_post_save` calls it for photos dropped from the list.
- `photo_drafts_sweep(p_days integer default 7)` (service role only): drafts not updated for `p_days` become
  `cancelled` and are released. The cleanup cron calls it once a run.
- [x] **Step 1: Failing pgTAP** `310`: Review focus 4; a sweep run twice queues nothing twice; `authenticated` cannot
  call either function.
- [x] **Step 2: Implement**, dump the schema.
- [x] **Step 3: Commit** `Photo posts: an abandoned draft's photos are deleted`.

### Task 4: Remove "Write a slideshow" (Session C)

**Files:** `apps/web/components/today/AgentWriter.tsx` (`ASK_KINDS`), `apps/web/lib/agent/tools.ts`,
`apps/web/lib/agent/run-line.ts`, `apps/web/lib/cmo/writer/jobs.ts` and `draft.ts` (`writeSlides`, the `slides`
kind), `apps/web/lib/cmo/jobs/runner.ts`, `types.ts`, `apps/web/lib/cmo/load-workspace.ts`, `apps/web/lib/cmo/mcp/inbox.ts`,
`apps/web/lib/cmo/skills/no-ai-slop.check.ts`, `packages/contracts/capabilities.json`, the checks that list the kind;
create `supabase/migrations/20270121030000_drop_write_slides.sql`, `supabase/tests/311_drop_write_slides.test.sql`.

- SQL: `cmo_job_daily_limit('write_slides')` becomes 0 (so `cmo_enqueue` answers "Unknown task."), its price is
  removed, queued or running `write_slides` runs are failed with their hold refunded through `credit_refund`. The kind
  stays in `cmo_runs_kind_check`: old rows keep it.
- Kept: everything that opens, renders or posts a slideshow already made (`SlidesView`, `components/cards/slides.ts`,
  `renderSlideshow`, the Studio list, `ui-v2-slides.spec.ts`), and Writer's list still shows old `slide_text` drafts.
- [x] **Step 1: Failing pgTAP** `311`: Review focus 3; a new `write_slides` is refused.
- [x] **Step 2: Implement**, `npm run check:contracts`, typecheck, dump the schema.
- [x] **Step 3: Commit** `Writer: no slideshow to write; a photo post replaces it`.

### Task 5: Ready for the owner's real accounts (Session C)

**Files:** create `docs/plans/cmo/2026-11-13-real-account-checklist.md`; modify
`apps/web/lib/departments/publish/zernio.ts`, `split.ts`, `zernio.check.ts`, `split.check.ts` only where Zernio's
documents disagree with the code.

- Read Zernio's documents (`docs.zernio.com`, `zernio.com/openapi.json`; the session that built Task 5 of #204 could
  reach them) for: `threadItems` on Threads, the text or code of X's refusal of a post over 280 characters, an image
  carousel on Instagram and Threads, TikTok Photo Mode. Quote each in the checklist with its URL and the date read.
  Fix the code where it differs, with a check. If the documents cannot be reached, say so and change nothing.
- The checklist is for a founder, not an engineer: for each of the three flows (a 900-character post to X free,
  Threads and LinkedIn; "Post as a thread"; a 4-photo post to TikTok), what to click, what they should see, and what
  to send back when it differs (the card's words and the time).
- [x] **Step 1:** documents read, differences fixed with a failing check first.
- [x] **Step 2:** the checklist.
- [x] **Step 3: Commit** `Publish: checked against Zernio's documents; a checklist for the first real posts`.

### Review (the controller, after every box is ticked)

`/code-review` (high) on this PR's diff against #204's branch, fix what it finds in one round, read the fixes once,
and list what is left in the PR. Screenshots of what changed on screen (Writer without the slideshow chip).

## 4. Not in this plan

- X beyond 4,000 characters (F4).
- Autopilot for Facebook, video or photo posts.
- Posting from real accounts: the owner runs the checklist of Task 5.
