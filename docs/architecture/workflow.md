# End-to-end workflow

Status: **built** (`main` at `4f70a59`, 2026-11-08; checked again for the CMO review 2 plan). Markdown twin of
[`workflow.html`](workflow.html), written for agents; the two must say the same thing. Built from
[`ai-cmo.md`](ai-cmo.md), [`brain.md`](brain.md), [`studio.md`](studio.md), [`approval.md`](approval.md),
[`schedule-publish.md`](schedule-publish.md), [`writer.md`](writer.md) and [`research-sales.md`](research-sales.md).
The order of work follows the owner's decision of 2026-11-08: the AI CMO first, the editor last
([plan](../plans/cmo/2026-11-08-cmo-review-2-plan.md) §2).

How the brain and the seven departments work together through one founder's week: who does what, which card the
founder sees, what costs credits, and where it is in the code.

## 1. Swimlane

Rows: You · Approval, Brain, Research, Writer, Studio, Sales, Schedule, Publish. Columns are the 11 steps below. After
step 11 the week's memory and lessons feed the next Sunday (step 2).

The steps follow the owner's sketch of 2026-11-08: business information → Writer → approval → Video → approval →
Post. Words are written before anything is built from them; the editor is the last step, where the founder fine-tunes
by hand.

## 2. The 11 steps

State: ✅ done · 🟡 partial · ❌ not built.

| # | When | Who does what | Your card or action | Credits | Built in |
|---|---|---|---|---|---|
| 1 | Once, at sign-up | **Research** reads the website and drafts the four marketing documents. **Publish** gives the Zernio connect link. The timezone comes from the browser | Read and edit the documents; connect X and the other accounts once; set the Brand Kit | onboarding | ✅ `lib/cmo/onboard.ts`, `site.ts`, `documents.ts`; Zernio connect `lib/departments/publish/accounts.ts`; `profiles.timezone` (`20261227093000`, set from the browser in `20270106010000`). 🟡 the setup screen still has five steps (`components/screens/setup/SetupScreen.tsx`); plan S2.2 cuts it to the website |
| 2 | Sunday | **Research**: competitor outliers on X, top shorts in the niche, last week's metrics and reply outcomes. **Brain · Reviewer**: lessons per topic, voice notes from your edits, the goal's result, next week's goal, corrections from repeated edits | A correction card when a repeated edit becomes a rule | research ≈ 2; reviews free | ✅ `jobs/competitor-research.ts`, `niche-video-research.ts`, `reply-outcomes.ts`, `summarize-memory.ts`, `review-week.ts`; `cmo_corrections` |
| 3 | Monday | **Brain · Planner** writes the week: posts, a slideshow, Reddit items, each a work order with a brief, a due day, a budget and the department that does it | Approve the goal and the week plan (one `plan` card; edit or remove items) | plan ≈ 1 | ✅ `jobs/plan-week.ts`, `work_orders` tree (`work_orders_plan_week`), `plan` card (`20270106050000`). 🟡 the plan still orders a one-minute AI video (`plan-week.ts:35`); plan S2.5 removes it |
| 4 | When a post is due | **Writer** drafts three versions per platform (X, Threads, LinkedIn) in your voice from memory; code checks length, words to avoid, numbers, no links, no hashtags; the checker (Claude, in a separate context) reviews once | Approve, edit then approve, or skip with a reason | ≈ 1 per post | ✅ `jobs/draft-post.ts`, `draft-thread.ts`, `check-post.ts`, `lib/cmo/platforms.ts`, `packages/contracts/platforms.json` |
| 5 | When a video is due | **Your own video:** you upload and edit it in the editor, then mark the edit finished. **AI long video, hidden for now** (owner, 2026-11-08): Writer's video brief → Studio's Director plans the beats → one storyboard card with one price for the whole video → one job hold → keyframes, shots, voice and music in one go → render → look check | Your own video: "Mark finished". AI video: card 1 (storyboard and one price), then the finished video (approving marks it finished) | your own: only what you ask for; AI video: one price on the card | ✅ `mark_finished` (`lib/departments/studio/finished.ts`); `build_video` order (`lib/cmo/jobs/studio-orders.ts`), `credit_orders`, `look_check` task. Hidden: plan S2.4 removes `/video` from the web app |
| 6 | When a video is finished | **Studio** Shorts squad cuts 3 shorts from the finished edit (AI video or your own edit you marked finished), 9:16, styled; **Writer** writes captions per platform, hashtags only here | Approve the batch of 3 | no generation credits | ✅ `lib/departments/studio/shorts/`, `short_batches`, `shorts`, `write_caption` |
| 7 | When a slideshow is due | **Writer** writes the slide text; **Studio** Slideshow squad builds the slides from captured pages and the Brand Kit; MP4 and a PNG set from one document | Approve, with quick text edits per slide, or open in Slides | only if an AI image is needed | ✅ `write_slides` → `build_slideshow` (`20270106020000`), `lib/departments/studio/slideshow/`, `render_stills` |
| 8 | When a Reddit item is due | **Sales** finds threads, scores them with exact quotes, checks the subreddit's rules, drafts a help-first reply (no links, the product at most once, about 1 reply in 10) | Copy the reply, open the thread, post it yourself; mark replied or dismiss | scan 5 | ✅ `jobs/sales-scan.ts`, `subreddit_rules`. 🟡 a scan started from the CMO chat shows no price card; plan S3.5 adds one |
| 9 | After any approval of something to post | **Schedule** proposes a time per platform (your data once there is enough, defaults before that), with gaps and daily caps, in your timezone | Approve the time and the account (changing either asks again) | free | ✅ `schedule_slots`, `schedule_propose`, `best_slots`, `packages/contracts/schedule-defaults.json` |
| 10 | At the approved time | **Publish**: the Modal clock finds the slot due; the worker posts through Zernio (X included); a signed webhook confirms. With no connected account, the slot is in `intent` mode and you get a notice with the composer filled in | Nothing, unless it failed (a card with the reason and a retry) | X API price passed through by Zernio | ✅ `jobs/publish-post.ts`, `lib/departments/publish/`, `publish_media` task, `app/api/webhooks/` (Zernio). Live only with the Zernio key (owner) |
| 11 | 24 hours after posting, and days after a reply | **Research** reads the numbers (Zernio for connected accounts) and re-reads Reddit threads you answered; everything goes to memory for Sunday | — | small | ✅ `jobs/pull-metrics.ts`, `metrics-source.ts`, `account_metrics`, `reply-outcomes.ts` |

**Every day, in the background:** the brain's progress check (code, `lib/cmo/jobs/progress.ts`) looks at every work
order (done, waiting on you, stuck, over budget); only a stuck order costs one replan. The weekly budget is a hard gate
for work the brain starts itself (`cmo_runs_budget_gate`), and spending too fast pauses the brain. Approval sends the
morning digest in the app and by email (`lib/cmo/digest.ts`, Modal `cmo_digest`); links open the card, never decide
it. The kill switch (`OPENCMO_CMO_PAUSED`, and each founder's Pause CMO) stops every order and every waiting slot
within one sweep.

**What the brain never does:** post anything you did not approve, with its time and account; reply on Reddit (Sales
has no post button); touch your own video edits (they stay hands-on in the editor until you mark one finished); spend
credits without a price on a card.

## 3. Cards in a typical week

Example: 5 posts, 1 finished video of your own and its 3 shorts, 1 slideshow, 2 Reddit replies. The daily card budget
(`card_budget`, about 10) holds back the rest for the next day.

| Card | How many | Step |
|---|---|---|
| Goal + week plan | 1–2 | 3 |
| Posts (versions per platform) | 5 | 4 |
| Finished video (AI video only; your own edit is marked finished in the editor) | 0–1 | 5 |
| Shorts batch | 1 | 6 |
| Slideshow | 1 | 7 |
| Reddit replies | 2 | 8 |
| Schedule (one per item; posts of one day can share a card) | ≈ 5–8 | 9 |
| Correction (some weeks) | 0–1 | 2 |

That is about 15–20 cards a week. Fewer cards (one approval for the words, one for what was made) gets its own plan
after this one ([plan](../plans/cmo/2026-11-08-cmo-review-2-plan.md) §5).

## 4. How the departments talk

| Wire | Carries | Built in |
|---|---|---|
| Work orders (rows) | The brain's orders to each department: brief, budget, depends on, due (`brain.md` §6). They sit beside `cmo_runs`, which stays the job queue | `work_orders`, `work_order_events`, `work_orders_follow_run` |
| Deliverables (rows) | What each department made, with a status; one table for posts, captions, videos, shorts, slideshows, images, replies, insights, metrics. It points at the row that holds the content (`content_items`, `opportunities`, `cmo_insights`, `clips`) | `deliverables` |
| Approvals (rows) | Every card, with a snapshot of content, price, time and account (`approval.md`) | `approvals`, `approval_raise`, `approval_decide` |
| Event rules | A status change creates the next order: video finished → shorts; short or post approved → schedule; due → publish; posted → measure | SQL triggers: `editor_projects_rules`, `tasks_studio_rules`, `approvals_caption_rules`, `schedule_follow_deliverable`, `work_orders_follow_approval` |
| The clock | Modal's daily schedule, its hourly digest and its every-minute sweep wake everything; no machine stays on | `packages/engine/modal_app.py` (`sweep`, `cmo_schedule`, `cmo_digest`, `cleanup`) |
| Studio adapter, Zernio adapter | The two doors to heavy work and to the platforms; the brain uses the same doors as buttons and MCP | `lib/departments/studio/adapter.ts`, `lib/departments/publish/adapter.ts` |
| Money | One price on one card, one hold for the whole job, pieces drawn from it, the rest given back | `credit_orders` (§5) |

## 5. Charge before running

Every paid job shows one card with one price that covers everything it spends, and runs to the end after one
confirmation (owner, 2026-11-05).

1. The card shows the plan and the estimate. Nothing paid has run yet.
2. Approve → `credit_order_open` holds the whole estimate in one `credit_orders` row (`kind` `long_take`,
   `explainer` or `studio_video`).
3. Each paid piece (a keyframe, a shot, the voice, the music, a render) moves its price from the job's hold to its own
   hold (`credit_order_draw`), so every existing settle and refund path works unchanged. A shot can wait on keyframes
   still being made (`startAfter` / `endAfter`, `20270109030000`), so every piece starts at once.
4. `credit_order_close` gives back what the job still holds. A job left open for a day (a tab closed, a crash) is
   closed by the reaper (`credit_orders_reap`, run from the sweep's turn reaper).
5. A failed or blocked piece is refunded; credits come back only for what failed or was blocked.

Fixes from the review of this work are in `20270110010000_review_fixes.sql`: one lock order for
`create_generation`, an explainer job tied to its clip and turn (`credit_orders.subject`), and an explainer turn's
tokens capped at `agent_3d_hold_credits()`. The same rule covers Studio orders (`studio_order_hold`, `brain.md` §9)
and the Assistant's turns (`brain.md` §9b).

## 6. Order of work

**Ranked by the CMO loop (owner, 2026-11-08):** does it make the loop work for a paying founder, end to end?
Editor work comes after, unless the owner says otherwise. Almost every department phase is built; what is left is
what stands between a paying founder and a working week.

1. **Business information:** paid-first entry, setup cut to the website, the first week plan and drafts within
   minutes (plan 2026-11-08, S2.1–S2.2).
2. **Writer:** a week plan without AI video (S2.5); every post platform already built.
3. **Approval:** no dead ends, one card per job (S2.6, S3.5–S3.6). Fewer cards a week gets its own plan.
4. **Video:** slideshow, shorts from a finished edit and the Brand Kit are built; the post image squad has no caller
   yet (`studio.md` §2). `/video` stays hidden (S2.4).
5. **Post:** Zernio live (owner: key, TikTok audit, price, terms); a provider that breaks shows on the Costs page
   (S3.1).
6. **Sales and Research:** R0, the data terms, before new lead types.
7. **The editor, last:** the long take's release, making `/video` cheaper and showing it again (its own plan).

**History.** Until 2026-11-08 this list was ranked by the editor strategy ("what lets us make and ship the next
OpenCMO marketing video comes first"): Writer W0, Studio S0, Approval A0–A1, Brain B0–B1, Studio S1–S2, Schedule
P0–P1 with Approval A2–A3, Brain B2–B3, Writer W1–W3 with Studio S3, Research R0–R2 with Sales R1, then the rest. All of
those phases were built in P1–P6 and the CMO review (#169–#180) except Research R0.

## 7. Open points

| # | Point | State |
|---|---|---|
| 1 | The look check: on every render or only before a card | **built**: only before a card (`look_checks`, worker task `look_check`) |
| 2 | Week plan size by default | built: 5–10 items, at most one slideshow a week (`plan-week.ts`) |
| 3 | Weekly credit budget per founder | built: a hard gate for the brain's own runs (`20270107010000`); the default is still to be set from measured credits per approved deliverable |
| 4 | Zernio checks (TikTok audit, price, terms) and ScrapeCreators' data terms | **open** (owner): before anything that depends on them goes on the landing page |
| 5 | Vercel Hobby | **open** (owner): its 300 s request limit forced the step cut at 280 s (#178), and its terms for commercial use apply |

Credit figures are today's job prices (`cmo_job_price`) or what each card shows; generation prices come from the
model catalog.
