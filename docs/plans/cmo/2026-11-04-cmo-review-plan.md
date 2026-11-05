# CMO review: what is still missing for a CMO that works

> **For agentic workers:** branch **`cmo-review`**, one PR into `main`. Work the batches in order. Each batch is green
> and pushed on its own. An item marked **owner** waits on an owner decision or an account; build around it and leave its
> box unticked with the question next to it. Every SQL change ships a new migration and a pgTAP test (never edit a
> merged migration), then `scripts/dump-schema.sh`.

## 0. Why this plan exists

On 2026-11-04 three agents audited every page in `docs/architecture/` against `main` (`dbf14aa4`): code, migrations
and pgTAP.

**Verdict:**
- **In code, about 80 % of the design is built and tested:**
  - the work-order spine;
  - one approvals table;
  - the Studio adapter and the Shorts squad;
  - Writer W0–W3;
  - schedule slots and best time;
  - Sales safety.
- **In production almost nothing runs:**
  - The v2 UI is behind `NEXT_PUBLIC_OPENCMO_UI=v2`, which is unset, so the inbox, schedule, accounts, analytics and the
    card pages behind email/push links all return 404.
  - Zernio (`OPENCMO_PUBLISH_LIVE`) is off.
  - Resend (`OPENCMO_EMAIL_LIVE`) and web push are off.
  - Every acceptance run used fake providers.
  - No real marketing video has been made end to end.

### Goal: a CMO that works

The plan is done when this test passes **on production, with real providers, on the owner's own account, with no
manual database edits**:

1. Sign up and paste the site. The brain learns the business: documents, Brand Kit and voice. The timezone comes from
   the browser.
2. Sunday: research runs (competitors, niche videos, last week's metrics and reply outcomes) and writes lessons.
3. Monday: a plan card shows the week (goal + items). The founder approves it.
4. Posts for X, Threads and LinkedIn arrive as cards. Approve one as is and edit one. The edit becomes a voice note.
5. One video: script card → price card → finished-video card (after a real look check) → **three** shorts on one
   batch card → captions per platform.
6. One slideshow card (if the owner keeps slideshows, see B2.3).
7. Two Reddit reply cards with evidence. The founder copies and posts by hand, then marks "I replied".
8. Schedule cards with time and account. After approval, posts go out through Zernio at the approved time. A missed or
   failed slot raises a new card. Nothing ever posts without an approved, unchanged card.
9. The next day, metrics and reply outcomes come back and show in Analytics. The next Sunday's lessons read them.
10. A founder away from the app gets the digest email and a push for an expiring card. The links open the card.
11. Pause stops everything. Spend never passes the weekly budget without a card.

Each batch below moves one or more of these steps from "built" to "works".

**Not in this plan:**
- the editor roadmap items that a working CMO does not need (listed in §7, for the editor plans);
- pricing (Polar/Creem);
- landing copy.

## 1. Decisions the owner must make first

**Decided 2026-11-04: the owner took every recommendation below (D1–D8).**

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | Release UI v2 to production and retire the v1 CMO screens | **Yes.** The CMO cannot work in v1: Studio and schedule cards have no screen there. | B1 |
| D2 | Zernio: TikTok audit, price per account, X pass-through cost, terms for a SaaS that resells posting, analytics add-on | Do the checks this week. Start live posting with X, Threads and LinkedIn; add TikTok after the audit. | B1, B4 |
| D3 | ScrapeCreators and Reddit data terms (R0, report in PR #133) | Decide from the report. Keep Sales off the landing page until then. | B4 |
| D4 | Video length the brain briefs | **60 s** (three 15–20 s shorts need ≈ 45 s of speech). Cost: about 2× the video credits per week. | B2.2 |
| D5 | Does the brain plan slideshows and post images? | **Slideshows yes, 1 a week; post images only when a post asks for one.** Both squads are built and cost no credits. | B2.3 |
| D6 | Weekly credit budget: hard or soft | **Hard for paid steps.** Past the budget, a paid step raises a price card instead of running. | B3 |
| D7 | Phone tab order | Keep what is built (Today · Approve · Calendar · Chat · More) until real use says otherwise. | — |
| D8 | Trademark check on the name "OpenCMO" (brain.md #6) | Before the public launch. | — |

## 2. B1 — Production switch-on (config + small code)

Steps 1, 8 and 10 of the goal test. Mostly configuration; the code items are small.

- [ ] **B1.1 owner** Vercel env:
  - `NEXT_PUBLIC_OPENCMO_UI=v2`;
  - `RESEND_API_KEY`, `OPENCMO_EMAIL_LIVE=1`, `OPENCMO_EMAIL_FROM` on a verified `opencmo.io` domain;
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`;
  - `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, `OPENCMO_PUBLISH_LIVE=1` (after D2);
  - `SCRAPECREATORS_API_KEY`, `CRON_SECRET`, `OPENCMO_MCP_CONFIRM_KEY`.
- [ ] **B1.2 owner** Add every variable above to `apps/web/.env.example`, with a one-line comment each. The Zernio
  variables and `NEXT_PUBLIC_OPENCMO_UI` are missing from it today. Agents cannot write `.env*` files here (a permission
  rule), so the owner pastes the block given in PR #162.
- [ ] **B1.3 owner** Modal secret: `OPENCMO_WEB_URL`, `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
  Redeploy. Confirm the per-minute `sweep` and the hourly `cmo_digest` are scheduled (`packages/engine/modal_app.py`).
  Without the secret, `sweep` skips firing slots and the digest never runs.
- [ ] **B1.4 owner** Zernio dashboard: add a webhook pointed at `/api/webhooks/zernio` with the shared secret.
- [ ] **B1.5 owner** Supabase prod: `supabase db push` through `20270105010000_review_followups.sql` before the deploy
  (see the "main via PR only" rule).
- [x] **B1.6** **Live switches** on the owner's Costs page (`/app/settings/costs`, gated by `app_owners` through
  `provider_spend_report`). It lists UI v2, email, push, Zernio posting, the webhook secret, the social reader, cron,
  MCP and the global pause. Each switch asks the module that decides it (`emailSender`, `vapidFromEnv`,
  `publishAnalytics`), so the page cannot drift from the code, and it never shows a secret value
  (`lib/ops/switches.ts` + `.check.ts`, in `check:contracts`).
  - Not done: "Modal clock last seen". It needs a heartbeat table; the follow-up is to write one row per `sweep`.
- [x] **B1.7** Timezone from the browser.
  - `profiles.timezone_source` (`default | browser | founder`) and `profile_timezone_detect(text)`
    (`20270106010000_cmo_review_timezone.sql`, pgTAP 245).
  - `components/shell/TimezoneSync.tsx` sends the zone once per browser, from both shells.
  - The zone is written only while the founder never chose one. Saving Settings marks the zone as the founder's, even
    UTC.
  - Existing accounts with a zone other than UTC are marked `founder`.
- [ ] **B1.8** Retire the v1 decide path once v2 is live on production.
  - Found while building: the v2 screens also call the old routes. Sales calls `/cmo/opportunities/[id]` and Setup
    calls `/cmo/goals/[id]`, so this is more than deleting v1.
  - It is not a safety gap. `approvals_sync` keeps `approvals` in step with every old RPC. Nothing goes out without a
    schedule card, and that card is hash-checked three times.
  - Do it after B4.8: give the Sales and Setup screens the card's id and `contentHash`, then delete `CmoWorkspace` and
    `app/api/v1/cmo/items`. Done: `grep cmo_decide_` in `apps/web` finds only SQL wrappers.
- [x] **B1.9** Dropped: D1 releases v2, so every card has a screen. If v2 is ever rolled back, revisit this item.

## 3. B2 — Close the week's loop (code)

Steps 3, 5, 6 and 9 of the goal test.

- [x] **B2.1** **Week plan card.**
  - `plan_week` raises a `plan` card (`ref_kind 'work_order'`, the week's root order) that shows every calendar item of
    the week, with its goal.
  - Unticking items and approving drops them while they are still only planned. The tree is then resynced through
    `work_orders_plan_week`, whose cleanup cancels the dropped items' orders and fails their queued runs (refunded).
  - Skip keeps everything. A replan replaces the card.
  - Built in `20270106050000_cmo_review_plan_card.sql` (pgTAP 249), the card contract and fixture, `PlanBody`, and
    `ApprovalCard`.
  - **Design change from this plan:** the card does not hold the week. Every post, reply and paid step still has its
    own card, so gating the whole tree would add a wait without adding a check.
  - Not seen in a browser yet: the local stack has no signed-in user. Look at `/app/inbox/card-plan` (sample) in B4.
- [x] **B2.2** **Three shorts, not one** (D4).
  - `cmo_video_seconds()` = 60 replaces the hard-coded 30 s in `work_orders_plan_week` and `work_orders_brief_rules`
    (`20270106020000_cmo_review_week_studio.sql`, pgTAP 246).
  - Writer's brief may still choose another length, as before.
  - Still to confirm with a real 60 s transcript in B4.2.
- [x] **B2.3** **Slideshows are ordered** (D5).
  - A plan item in the video department with platform `Slideshow` (at most one a week, counted apart from the video,
    `plan-week.ts`) becomes `write_slides` → `build_slideshow` (TikTok, 9:16).
  - A replan that drops it cancels both orders and fails the queued slides run.
  - The planner prompt asks for a slideshow most weeks. The fake plan adds one only when the brief says "slideshow".
  - Not done yet: post images from a post, and MCP/adapter entries for slideshows. Post images stay "only when a post
    asks for one" (D5), but nothing asks yet, so this moves to B5.5.
- [x] **B2.4** **Metrics 24 h after posting.**
  - Modal's per-minute sweep already calls `schedule_claim_due`. It now also queues one `pull_metrics` run
    (`source: event`) per founder whose post turned 24 h old, at most once per post.
  - It skips paused founders, and the day's cap leaves the post to the daily loop.
  - No Modal change was needed (`20270106040000_cmo_review_metrics_24h.sql`, pgTAP 248).
- [x] **B2.5** **Research reads Hacker News** (R4).
  - `competitor-research.ts` searches HN for up to 3 competitor names from Competitor Analysis. It measures stories
    against the search's own median (points + comments) and cites HN discussion URLs.
  - A founder with competitors but no X handles now gets research from HN alone.
  - HN being slow or busy never fails the run.
  - Not done: Reels in niche video research. It waits on what ScrapeCreators returns for Reels (R0, D3).
- [x] **B2.6** **Studio send-back teaches.**
  - A reason on a sent-back finished video, shorts batch or slideshow becomes a topic `video` memory (importance 3).
    Writer's video brief reads it through `writerMemory`.
  - Built as the trigger `approvals_studio_lesson`, so `approval_decide` stays as it is
    (`20270106030000_cmo_review_studio_sendback.sql`, pgTAP 247).
  - Not done: a `cmo_draft_outcomes` row for Studio. Its department check allows only post and sales, and the
    approval measures in B5.6 will read `approvals` directly.
- [ ] **B2.7** **Same-day posts on one card** (approval rule 3). Batch the post cards of one day into one card, the way
  shorts already are. Approve all, or open each one.

## 4. B3 — Budgets and gates the design promises (code)

Step 11 of the goal test. Today the weekly budget is soft, overspend is logged and never refused, and there is no cost
ceiling.

- [x] **B3.1** **The weekly budget is hard for work the brain starts** (D6).
  - A `before insert` trigger on `cmo_runs` refuses a paid run with source `schedule`, `event` or `replan` that would
    take the week past its budget. Credits held by runs still in flight count.
  - It is refused before any credit is held, and the reason reaches the order, the cron log and the Brain page.
  - The founder's own asks (chat, buttons, MCP) and Studio steps behind an approved price card are not gated.
  - Design change: `work_order_spend` records money after it moved, so the gate sits where a run is created, not there
    (`20270107010000_cmo_review_budget_gate.sql`, pgTAP 250).
- [x] **B3.2** **Cost ceiling.**
  - More than max(10, 40 % of the weekly budget) credits of brain-started runs within an hour pauses the founder's
    brain (`cmo_paused_at`) and writes a note on the week.
  - The run that crossed the line still goes; later ones wait for Resume.
- [x] **B3.3** **Registry step limits are enforced at runtime** for CMO jobs.
  - `lib/cmo/step-limits.ts` reads `max_steps` from `capabilities.json`, and the job runner stops a run at its kind's
    limit. It fails with a refund instead of looping.
  - Every job in `jobs.check.ts` runs under the limits.
  - Studio order steps are each a founder card already, so they are not limited here.
- [x] **B3.4** **The Studio price card reads the order's budget.**
  - A price card the brain raises for a video order says "N credits past this video's budget" when it is
    (`steps.ts`, `withBudgetNote`).
  - The card is still the founder's decision, so it is raised, not refused. The founder's balance check stays as it
    was.
- [x] **B3.5** **Stage fit.**
  - The planner prompt says to fit the business's stage.
  - `fitStage` in `plan-week.ts` drops an item that needs customer proof (quotes, testimonials, reviews, case studies,
    results) when the documents hold none. The brain eval judges by the same regex.
  - The documents have no stage field, so proof in the documents is the signal.
- [x] **B3.6** **Replan uses the repair hint.**
  - `replanBrief` adds the failure's `repair_hint`.
  - `build_video` and `build_slideshow` are replannable too, next to posts and Reddit. A sent-back video becomes a
    replan of the week with the founder's reason and the fix.
  - A failure marked `retryable: false` is left to the founder.
  - Captions follow their video and are not replanned on their own (`progress.ts`, `progress.check.ts`).
- [x] **B3.7** Dropped: price cards do not expire.
  - Card 2 comes after the keyframes were made and paid for, so an expired card would throw paid work away.
  - Nothing is spent until the founder approves. The card's price and hash keep it honest while it waits.
- [x] **B3.8** The global kill switch `OPENCMO_CMO_PAUSED=1` is read by Modal's sweep too (`paused_everywhere`).
  - While it is set, no slot is fired and no run is dispatched. Before, slots fired into runs the web refused, then
    missed their window.
  - **Owner:** add `OPENCMO_CMO_PAUSED` to the Modal secret when you pause, and redeploy Modal for the code.

## 5. B4 — Real runs (acceptance on production)

Every acceptance run so far used fakes. A working CMO is proven only by real runs. Each item ends with its numbers in
`../opencmo-internal/note.md` and its artifact kept as landing material.

- [ ] **B4.1** **S0: one real 60 s OpenCMO video** made by the brain, from brief to finished card, on production
  (long-take plan Tasks 0, 1 and 8). Extract a frame from the full-size file and look at it ("Verify by looking").
- [ ] **B4.2** Three real shorts from it. **Peak RAM per render < 2 GB** (`/usr/bin/time -v`); this has been open since
  the P2 acceptance.
- [ ] **B4.3** One real look check with the vision judge (first real call).
- [ ] **B4.4** One real slideshow (P5 acceptance), kept for the landing page.
- [ ] **B4.5 owner (D2)** One supervised real post through Zernio on X. Watch the webhook, the receipt and the metrics
  the next day.
- [ ] **B4.6** Real-model eval runs, one each: Writer W0 before/after (`cmo:eval --provider anthropic`), brain plan eval,
  Studio eval, slideshow squad. Record the scores.
- [ ] **B4.7** Real email digest and push on the owner's phone. The links open the card.
- [ ] **B4.8** The whole goal test of §0, one real week.

## 6. B5 — Output quality the design promises

Not needed for the loop to run, but needed for the output to be worth approving. Do these after B4.1 shows where the
real video falls short.

- [ ] **B5.1** **Shorts style step:** hook title, captions with emphasis and punch-ins on each short (studio.md §6).
  Today a short only inherits the parent edit's styling.
- [ ] **B5.2** **Segmenter** uses pauses (word gaps) and topic shifts, not only sentence-ending punctuation
  (`shorts/squad.ts:35`).
- [ ] **B5.3** **Active-speaker reframe for 9:16** (roadmap E1.2). Today the frame is `fill`.
- [ ] **B5.4** **Slideshow MP4:** transitions and a music bed. Then TikTok photo mode and carousel posting through
  Zernio, after D2.
- [ ] **B5.5** **Post image** generates one only when no frame or page fits. This costs credits, so it needs a price card.
- [ ] **B5.6** **Measures** for Approval: time from card to decision, cards per day, expired and replaced cards.
  Approved-as-is per platform and per hook type. Look-check pass rate per squad. These go on the Brain page.
- [ ] **B5.7** Assistant priced chat cards are recorded in `approvals` (owner decision #5 in approval.md), and MCP can
  decide a card through `approval_decide` with the row id and a signature, not a separate code.
- [ ] **B5.8** Library: an on/off toggle per skill, and a brief can name the Library items to load.
- [ ] **B5.9** Writer W4: `write_article` (long draft). Last.

## 7. Missing, but owned by other plans (listed so nothing is lost)

These items are on the editor spearhead roadmap (`docs/plans/editor/2026-10-19-editor-spearhead-roadmap.md`). Each
gets its own research and plan.

**Built, but not ticked in the roadmap** (tick them in B6):
- E0.2, E0.3, E0.5
- ES.3, ES.4, ES.5, ES.6
- E1.1
- E3.11
- E4.4
- E6.1, E6.2

**Not built:**
- E0: E0.6 export outcome report, E0.8 debug page, E0.9 feature flags.
- **E2.1–E2.8: record our own product** (screen recording, zoom, blur, device frame). This is the largest gap for
  OpenCMO's own marketing videos.
- E3: E3.2 recipes (demo, launch, tutorial, changelog), E3.5 templates, E3.7, E3.8, E3.9, E3.12.
- E4: E4.1 export set (16:9, 9:16 and 1:1 in one request), E4.6 public share page, E4.7 export at source resolution,
  E4.8.
- E5: E5.3–E5.9.
- E6: E6.3, E6.6.

**Needs a manual check on production:** E0.1 Modal export, E0.4 deploy backlog, ES.2 every slash command, ES.7 landing,
ES.8 first-run path.

## 8. B6 — Docs match the code

- [ ] **B6.1** Every page in `docs/architecture/` (md and html together): status "proposed" → "built, see
  `ARCHITECTURE.md`". Replace each "Today (`eb858ca`)" table with a short "Built" note. Record where the build moved
  away from the design:
  - `work_orders` sits beside `cmo_runs`;
  - `deliverables` wraps `content_items`;
  - clips became `shorts`, each its own clip;
  - corrections come from a repeated-edit trigger;
  - headless Studio is an order runner;
  - the look check is a worker task;
  - Zernio has 6 platforms;
  - X posts carry no hashtags;
  - the MCP confirm code lasts 600 s;
  - `cmo_insights.kind` includes `niche_video`.
- [ ] **B6.2** `ARCHITECTURE.md` §11:
  - remove "OpenAI moderations" and "The CMO never edits video";
  - add `work_orders`, `deliverables`, `approvals`, `schedule_slots`, Zernio, push, the Modal `sweep`/`cmo_digest`
    clock and the `look_check` task.
- [ ] **B6.3** Editor roadmap: tick the built items (§7). Remove Lottie and 3D from §2's strengths.
- [ ] **B6.4** studio.md: 25 models (3D and Lottie removed), 45 eval tasks. writer.md: X threads are built.

## 9. Order and size

| Batch | Size | Waits on |
|---|---|---|
| B1 switch-on | S (config) + S (code) | D1, D2 |
| B2 week loop | L | D4, D5 |
| B3 budgets and gates | M | D6 |
| B4 real runs | M (time, credits) | B1, B2.2 |
| B5 quality | L | B4.1 |
| B6 docs | S | none; can run alongside B1 |

The CMO "works" at the end of B4.8. B5 makes its output better, and §7 is the editor's own roadmap.

## 10. Verification per batch

- `npm run typecheck && npm run build`, and `cd apps/web && npm run check:contracts && npm run test:e2e` (one suite at
  a time).
- `npm run db:reset && npm run db:test` for every migration, then `scripts/dump-schema.sh`.
- Engine changes: `.venv312/bin/python -m pytest -q && .venv312/bin/python -m ruff check .`, plus `/usr/bin/time -v` for
  any render.
- B4: real artifacts, frames looked at, and numbers written down. Green tests are not enough.
