# Close the CMO loop: review fixes for #181, then the script item and the founder's video

Source: a code review of `main...cmo-review-2` at `cdbbdaa` (2026-11-09), the owner's decisions of 2026-11-08 and
2026-11-09 (`CLAUDE.md` "Strategy"), and the gaps the architecture pages still list after #181.

Two parts, two branches:

| Part | Branch | When |
|---|---|---|
| **R. Review fixes** | `cmo-review-2` (PR #181) | now, before #181 merges |
| **C. Close the loop** | `cmo-close-loop`, cut from `main` after #181 merges | after R |

## 1. Why

After #181 the CMO leads, `/video` is hidden and the founder makes the videos. Measured against the owner's sketch
(website → Writer → approval → Video → approval → Post), three pieces of the loop are still missing:

1. **No script for a video.** S2.5 dropped every video item from the week plan, so the CMO writes no script at all.
   The Writer's brief has an angle, three hooks and key points (`lib/cmo/writer/types.ts` `VideoBriefSchema`), with no
   storyboard. `work_orders_plan_week` turns every non-slideshow video item into `write_video_brief` + `build_video`,
   and the CMO must not order `build_video` any more.
2. **The founder's finished video cannot be posted.** `schedule_propose` makes slots only for posts, shorts and
   slideshows (`ai-cmo.md` §10). The sketch's "video + caption" lane stops at the editor.
3. **The post image has no caller.** The Post image squad is built (`lib/departments/studio/slideshow/post-image.ts`),
   but nothing outside the acceptance runs creates a `build_post_image` order. The sketch has "post draft → image" for
   Instagram and TikTok.

The review of #181 also found bugs in it that should not ship (Part R).

## 2. Part R: review fixes in #181 (before merge)

One session on `cmo-review-2`. Each fix gets a regression test (pgTAP for SQL, a `*.check.ts` or e2e for the web).
New migrations go above the last one on the branch.

- [x] `9f1c3ba` **R1 Studio orders show "Over budget … of 0 credits"** (`20270111020000_billing_review_fixes.sql:89`).
  `studio_order_release_hold` now adds the hold-covered usage to `work_order_spend`, but `cut_shorts` orders are
  created with `budget_credits = 0` (`cut_shorts_order_for`), and slideshow orders the same way. Every shorts or
  slideshow order then ends with an over-budget note. Fix: give these orders the budget of their hold (5), or count
  the covered usage on the parent only. Keep the week's root counting the spend (that was the point of S3.7). The test
  covers a shorts order that uses 2 credits: no over-budget note, and the root counts 2.
- [x] `9f1c3ba` **R2 "I posted it" on an invalid thread** (`20270111200000_post_myself.sql:33`). The RPC refuses any body with a
  `thread` of 5 or more items. The card treats only a valid thread (`thread_valid`) as a thread, so an invalid one
  gets the button and then an error. Fix: use `public.thread_valid(v_item.body)` in the RPC, the same rule as the card.
- [x] `baa0593` **R3 `?paid=1` skips the paid-first gate** (`apps/web/app/app/page.tsx:40`). An unpaid account that opens
  `/app?paid=1` reaches Setup with "Payment received" and then gets a 402. Fix: on `paid=1`, still check the plan or
  credits. Show "Payment received" only once they exist, and otherwise "Waiting for your payment" with a link back to
  billing.
- [x] `baa0593` **R4 The first draft can be dropped** (`apps/web/lib/cmo/jobs/start.ts:51`). If Modal's sweep claims the first
  plan before `after()` does, the plan is not `done` when checked, and the first draft is never queued. That breaks
  "a draft within minutes". Fix: queue the first draft from the plan's completion (a trigger or the runner's
  on-done step), not from the `after()` that may not have run the plan. Test: a plan finished by the sweep still
  queues the draft.
- [x] `5fc1ad4` **R5 An unknown approval tool returns a fake "Nothing was charged"** (`apps/web/lib/agent/scope.ts:573`). Limit
  the fallback to the retired `animate_video` name, and throw for anything else.
- [x] `5fc1ad4` **R6 The accounts read never retries** (`apps/web/components/cards/connected.ts:27`). After a failed
  `/api/v1/accounts`, the card stays without "I posted it" until it remounts. Fix: retry once, and fall back to
  showing both paths rather than none.
- [x] `baa0593` **R7 Onboarding's deadline is anchored late** (`apps/web/lib/cmo/onboard.ts:54`). Pass the request start time
  from the route, so the deadline is 300 s minus the margin from the real start.
- [x] `5fc1ad4` **R8 "Scan now" shows a charge when the mode read fails** (`components/screens/sales/SalesScreen.tsx:59`). When
  `/cmo/mode` fails, show the card without a price and say the mode could not be read, rather than "Approve and spend
  5 credits".

Checks: `npm run typecheck`, `check:contracts`, pgTAP on a reset database, the S2 e2e (`ui-v2-activation`). Then the
owner measures pay → website → first draft on a preview, now that the keys are set.

**Done 2026-11-09** (local stack, Supabase CLI 2.117.0):
- pgTAP: all 170 files, 2,895 tests, pass on a reset database.
- New tests: 271 (R1, R2) and 272 (R4). Each fails without its migration and passes with it.
- `ui-v2-activation` e2e: 3 of 3 pass. It now also checks that a hand-typed `?paid=1` shows "Waiting for your
  payment". With the fake model, the time from website to the plan card and the first draft is 3 s.
- `npm run typecheck` and `check:contracts` pass.
- Assistant eval (fake): every task passes except the 4 explainer previews. Those fail the same way before and after
  this change, because the sandbox cannot reach `remotion.media`; CI runs them.

## 3. Part C: close the loop (after #181 merges)

Ranked by the CMO loop. Each item starts with a short research note (what the code does, `file:line`; what changes;
how it is checked), as `CLAUDE.md` asks.

### C1 The script item (first) — done `7377f50c`

The week plan orders **a script and a storyboard** for a video the founder makes. The CMO never builds it.

- **Plan:** `plan-week.ts` allows at most one `video` item a week with platform `Script` (beside the slideshow),
  only when the strategy or the week's goal calls for video. `toPlanItems` keeps it.
- **Work orders** (migration): in `work_orders_plan_week`, a `Script` item creates `write_video_brief` only, with no
  `build_video`. Remove the CMO's path to `build_video` in the event rules and `create_task` (`cmo-tools.ts`). MCP keeps
  `create_video`. pgTAP: a plan with a Script item creates one brief order and no Studio order.
- **Writer:** `VideoBriefSchema` gains a storyboard, one beat per row: what is said, what is on screen, and
  the shot (talking head, screen recording, B-roll), with seconds. It is written for the founder to record, not for a
  model to render. `NO_AI_SLOP` stays in the prompt, and `writer.check.ts` checks the beats (count, total length, no
  invented numbers).
- **Card:** a `script` approval card shows the hooks and the storyboard. The founder can edit a beat or approve. The
  `approvals` kind `script` already exists (`approvals_kind_check`); reuse it, with a ref to the brief rather than a
  `studio_steps` row. Approve is free: nothing is built.
- **Open in editor:** after approval, the card's main action opens a blank edit. The script sits in the Assistant
  panel and one marker per beat is set on the timeline (`set_marker`), so the founder records or uploads against it.
  The edit remembers its brief, so "Mark finished" can carry the hooks into captions (C2).
- Check: a CMO eval case where the strategy calls for a demo video and the plan holds one Script item, with a
  storyboard. An e2e covers plan → script card → approve → Open in editor, with markers present.

**As built (2026-11-09, `7377f50c`):**
- One video item a week. Its platform is Shorts, Reels or TikTok (`plan-week.ts` `toPlanItems`).
- SQL orders `write_video_brief` only, carrying the item (`20270112010000_script_item.sql`). A replan keeps the
  script, or cancels it with its run and refunds the credit.
- `VideoBriefSchema.storyboard` holds 3 to 8 beats, each with say, show, shot and seconds. The beats are checked for
  count, total length (±20%), pace (3.5 words a second) and invented facts.
- `work_orders_brief_rules` keeps the storyboard on the order and raises a `script` card with
  `ref_kind = 'work_order'`. The card is free and shows "To camera / Screen / You film".
- Approve or edit a beat (the edit saves the words and closes the card as `edited`). "Approve and open in editor"
  then calls `cmo_script_open`: one blank edit per script, kept on the order. Next, `/api/v1/cmo/scripts/[id]/open`
  sets one marker per beat, skipping markers already placed. The Writer screen offers "Open in editor →" for
  approved scripts.
- Tests:
  - pgTAP 273 and the 7 updated files;
  - the writer, jobs, studio-orders, screens, load and script-markers checks;
  - e2e `ui-v2-script`: card → approve → editor with 3 markers → the Writer screen opens the same edit.
- Code review fixes (2026-11-09):
  - the replan's relink names its candidate;
  - the calendar item follows the card (`in_review`, then `approved` or `skipped`), so a replan keeps a written
    script;
  - a script whose item was dropped raises or keeps no card;
  - the markers go in one write with a version check;
  - the Writer board puts an approved script in "Scheduled" and reads the live card first;
  - one beat check (`approval_script_beat`);
  - one `openScript` helper.
- **Not done:** a CMO eval case for a week with a script.

### C2 The founder's finished video goes out — done `8e4167e4`

**Research note (2026-11-09):** today "Mark finished" on the founder's own edit (`mark_finished`) only closes the card.
`editor_projects_rules` orders `cut_shorts`. Nothing renders the long video, nothing raises its `finished_video` card
(that card, and the captions it orders through `approvals_caption_rules`, exist only for a `build_video` order's
render via `look_check_raise`), and no `video` deliverable is made (`mark_finished` makes one only for a `build_video`
order). `schedule_propose` makes slots for `post`, `short` and `slideshow` only. So C2 needs the tail of the old
video pipeline for the founder's own edit:
1. Finished → render the finished hash (`render_document`) → look check → `finished_video` card. The card orders the
   captions, as it does today.
2. Approving it makes a `video` deliverable under a work order. Today none exists for an own edit: create one, or put
   it under the `cut_shorts` order.
3. `schedule_propose` and `schedule_follow_content` take `video` like `short`, with YouTube, LinkedIn and X.
4. Check that `publish_post` posts the render of the approved hash.

That is a migration plus the Studio runner: its own session, not a patch.

The sketch's lane: video + caption → schedule.

- On "Mark finished" (`lib/departments/studio/finished.ts`), the existing event rule cuts shorts (owner: shorts stay
  automatic). It now also orders `write_caption` for the long video itself, using the brief's hooks when the edit came
  from a script item.
- `schedule_propose` makes a slot for a finished long video (YouTube, LinkedIn, X) as it does for shorts. The export of
  the finished hash is the file Zernio posts.
- pgTAP: marking an edit finished creates the caption order and, after the caption card, a schedule slot for the long
  video. Look at a frame of the export that would be posted (`CLAUDE.md` "Verify by looking").

### C3 Post images for posts that need one — done `917d3968`

**Research note (2026-11-09):** the Post image squad (`lib/departments/studio/slideshow/post-image.ts`, order
`build_post_image`) and its schedule hook (`schedule_image_changed`) are built. Writer drafts posts only for X,
Threads and LinkedIn (`lib/cmo/platforms.ts`, kind `post`); Instagram and TikTok are captions on a video. So "post
needs an image" means an X, Threads or LinkedIn post the planner marks. It needs:
- a plan field;
- an order created when the post is approved;
- an e2e.

- `plan-week.ts` or the post draft marks a post that needs an image (Instagram, TikTok photo posts; an X post the
  strategy says works better with one).
- After the founder approves the words, the Post image squad builds one image from the Brand Kit and the post. It uses
  the existing `build_post_image` order, the Studio hold and Creem moderation. The image joins the post's schedule card.
- Images only when the post's platform needs one: a text post on X stays text.

### C4 Fewer cards a week (research first, then decide) — research done: [`docs/research/agents/2026-11-09-weekly-approvals.md`](../../research/agents/2026-11-09-weekly-approvals.md); recommendation: the post card carries its time (about 5–8 fewer cards a week). Waits on the owner.

The sketch has two approvals: the words, then what was made. A week is about 15–20 cards today (`workflow.md` §3).
C4 is a research note with a recommendation, not code:
- batching the day's posts into one card;
- approving the week plan with its drafts in one pass;
- what Typefully and Buffer do for a weekly queue.

The owner decides before it is built.

## 4. Sessions for Part C

One branch, `cmo-close-loop`, and one PR. Cut the branch from `main` after #181 merges, before any session starts.

| Session | Items | Owns | Waits on |
|---|---|---|---|
| **A Backend** | C1 plan, work orders and Writer; C2 SQL and the caption order; C3 order | `supabase/migrations/*` (all), `supabase/tests/*`, `current.sql`, `lib/cmo/jobs/plan-week.ts`, `lib/cmo/writer/**`, `lib/departments/studio/finished.ts`, `lib/agent/cmo-tools.ts` | nothing |
| **B Cards and editor** | C1 card and "Open in editor"; C2 and C3 on the cards and Schedule screen | `components/cards/**`, `components/editor/assistant/**`, `components/screens/{writer,schedule,dashboard}/**`, `lib/agent/scope.ts` above `cmoScope` | A's brief schema (C1); B starts on the card from a fixture |
| **C Research** | C4 note | `docs/research/agents/2026-11-*-weekly-approvals.md` | nothing |

A builds the storyboard schema first and pushes it before anything else, so B builds on it.

## 5. Done when

- **R:** R1–R8 are fixed with tests, CI is green, and the owner has measured pay → website → first draft on a preview.
  Then #181 merges.
- **C:** a paying founder's week holds posts, a slideshow and one script item. They approve the script, open it in
  the editor, record against the markers, and mark it finished. They get 3 shorts and a caption card for the long
  video, and every piece gets a schedule card. No step builds a video without the founder. Measured on a preview,
  with a frame of the posted export looked at.

## 6. Not in this plan

Articles. New Sales lead types (R0). Making `/video` cheaper and showing it again. One Assistant replacing the CMO
chat and the Editor Assistant. Removing the v1 UI. `credit_order_draw` with one ledger row (S3.7 left it for the
owner: it changes the money primitives).
