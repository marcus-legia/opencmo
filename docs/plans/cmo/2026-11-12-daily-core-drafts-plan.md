# A draft ready every day on every platform the founder picked (Test 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every morning, each platform the founder ticked in the planner has its draft ready: a text post for X,
Threads, LinkedIn and Facebook, and a script with its caption for each video the founder planned.

**Architecture:** the CMO writes **one core post** per posting slot (not one per platform) and the planner says which
platforms it goes to. One approved post fans out to one schedule slot per target. Length differences are handled by
code, not by the model: Threads splits a long post into a chain, X takes the long post as is (X Premium). Rewriting for
one platform is an optional, paid button. Video items get a script, a storyboard and a caption from the run that
already writes the script.

**Tech stack:** Next.js (apps/web), Supabase SQL + pgTAP, Zernio publish adapter, Claude (Sonnet writes, Haiku checks).

**Spec:** this file, §1 (decisions of the owner, 2026-11-12). Reads with
[`2026-11-12-autopilot-one-screen-plan.md`](2026-11-12-autopilot-one-screen-plan.md) (autopilot) and
[`2026-11-09-script-item-plan.md`](2026-11-09-script-item-plan.md) (script items).

## 1. Why, and what the owner decided (2026-11-12)

**What is wrong today** (read from `main` at `482dcdb6`):

- `plan_week` puts every post on X unless the Content Strategy *names* Threads or LinkedIn
  (`lib/cmo/jobs/plan-week.ts:35`), and the strategy schema has only an "On X" field (`lib/cmo/documents.ts:57`). So
  founders see X drafts only.
- The planner does not read the connected accounts, and the founder has no control over platforms or counts:
  `WEEKLY_POSTS = { x: 7, threads: 5, linkedin: 3 }` is hard-coded.
- Each platform gets its own draft run (3 versions + checker), so more platforms cost more tokens linearly.
- There is no Facebook anywhere. There is no repurpose step.
- "Slideshow" means slides the CMO builds (`build_slideshow`). The owner means TikTok Photo Mode / Instagram carousel:
  photos the founder uploads.

**Decisions:**

| # | Decision |
|---|---|
| D1 | **The core is two things.** A text post of real quality (not a short line + an image), and for video: a script and a caption the founder records and edits from. |
| D2 | **The planner is the founder's.** They tick the platforms and set how many posts a day per platform (text) and how many videos a week per platform (video). The CMO writes what the planner asks, nothing more. |
| D3 | **One core post serves every ticked platform.** No per-platform draft by default. |
| D4 | **Repurpose is optional:** a button on the card, "Rewrite for LinkedIn", runs one paid rewrite for that platform only. |
| D5 | **Threads:** a post over 500 characters is split into a Threads chain by code. One click, no error. |
| D6 | **X:** no character limit (most founders have X Premium). Autopilot may post long X posts. A Threads chain is a thread and stays out of autopilot (rule unchanged). |
| D7 | **Carousel / slideshow** = photos the founder uploads (TikTok Photo Mode, Instagram carousel). The CMO writes the caption only. It is its own small flow, not part of the editor. `build_slideshow` is removed. |
| D8 | **Video count is the founder's choice** in the planner (0 by default). |
| D9 | **Facebook:** Meta's API does not post to a personal profile (removed in 2018; Zernio: "personal profiles cannot post through the API"). Facebook **Page** posts through Zernio. A personal profile gets the same draft with copy-and-open. |
| D10 | **Sales stays by hand.** Nothing here touches Sales. |

## Global Constraints

- Every word a reader sees goes through no-ai-slop: a new prompt embeds `NO_AI_SLOP` and is added to
  `lib/cmo/skills/no-ai-slop.check.ts`.
- Writing agents run on Sonnet, small tasks on Haiku; no other vendor.
- Charge before running: the repurpose button shows its price and holds credits before the model runs.
- Every write goes through an ownership-checking RPC; money only through `credit_hold` / `credit_settle` /
  `credit_refund`.
- Migrations continue after `20270119010000`, pgTAP tests after `298_…`. After each migration run
  `scripts/dump-schema.sh`. Never edit an applied migration (`.claude/skills/supabase-migrations`).
- A number in `packages/contracts/platforms.json` changes together with SQL `platform_profile()` (check:contracts).
- User-facing strings, SQL `raise exception` text and `jobs.error` text in English.
- Autopilot rules from `CLAUDE.md` stay: posts only, never Reddit, never a thread, three skips turn it off.

## Review Focus

1. **A founder with no connected account.** Every target becomes a copy-and-open slot; nothing errors, drafts still
   appear daily. Test in Task 3 (`schedule_propose` with no account → `mode = 'intent'` for every target).
2. **A founder with a free X account posts a 600-character post.** Zernio rejects it. The slot must fail with a sentence
   the founder can act on and a "Post as a thread" button, never a raw Zernio error. Test in Task 4.
3. **A Threads post that splits badly:** one sentence over 500 characters, a URL-free emoji-heavy text, a post of
   exactly 500. Every part ≤ 500, no empty part, no word cut in half unless one word is over 500. Test in Task 4.
4. **The founder changes the planner mid-week.** Items already drafted keep their targets; only items still `planned`
   (not drafted) take the new targets. Test in Task 2.
5. **Old rows.** Post items made before this change have no `targets`; they keep posting to their one `platform`.
   Test in Task 3.

---

## 2. File map

| Area | Files |
|---|---|
| Posting plan (data + RPC) | `supabase/migrations/20270120010000_posting_plan.sql`, `supabase/tests/299_posting_plan.test.sql` |
| Posting plan (code) | Create `apps/web/lib/cmo/posting-plan.ts` (+ `.check.ts`) |
| Planner UI | `components/today/CalendarView.tsx`, create `components/today/PostingPlanPanel.tsx`, `app/api/v1/cmo/posting-plan/route.ts` |
| Week plan | `apps/web/lib/cmo/jobs/plan-week.ts` |
| Core post | `packages/contracts/platforms.json`, `apps/web/lib/cmo/platforms.ts`, `apps/web/lib/cmo/jobs/draft-post.ts`, `apps/web/lib/cmo/schedule.ts` |
| Fan-out | `supabase/migrations/20270120020000_post_targets.sql`, `supabase/tests/300_post_targets.test.sql` |
| Threads split, X fallback | Create `apps/web/lib/departments/publish/split.ts` (+ `.check.ts`), `zernio.ts`, `lib/cmo/jobs/publish-post.ts`, schedule card |
| Facebook | `lib/screens/common.ts`, `lib/departments/publish/types.ts`, `zernio.ts`, `supabase/migrations/20270120030000_facebook.sql` |
| Video caption | `apps/web/lib/cmo/writer/types.ts`, `writer/prompts.ts`, `writer/jobs.ts` |
| Repurpose | `supabase/migrations/20270120040000_post_variants.sql`, create `apps/web/lib/cmo/jobs/repurpose-post.ts`, `packages/contracts/capabilities.json` |
| Remove `build_slideshow` | `studio-orders.ts`, `plan-week.ts`, `load.ts`, `capabilities.json`, `supabase/migrations/20270120050000_drop_slideshow_order.sql` |
| Photo post | Create `components/today/PhotoPostPanel.tsx`, `app/api/v1/photo-posts/…`, `supabase/migrations/20270120060000_photo_post.sql` |
| Rules | `CLAUDE.md` (Product rules), `docs/architecture/ai-cmo.md` + its HTML twin |

## 3. Order

Branch `claude/social-media-autopilot-issue-d7117d` (this plan's), one PR per phase so each can ship on its own. **Phase A is Test 1**; B–E follow.

| Phase | Tasks | Ships |
|---|---|---|
| A | 1–3 | planner + core post + fan-out: a draft every day on every ticked text platform |
| B | 4 | Threads chain, X long posts, autopilot rule |
| C | 5 | Facebook Page |
| D | 6 | caption with every video script |
| E | 7–9 | repurpose button, `build_slideshow` removed, photo post |

---

### Task 1: The posting plan (data, RPC, pure helpers)

**Files:** migration `20270120010000_posting_plan.sql`, test `299_posting_plan.test.sql`, create
`apps/web/lib/cmo/posting-plan.ts` and `posting-plan.check.ts`.

**Interfaces — produces:**

```ts
export const TEXT_PLATFORMS = ["x", "threads", "linkedin", "facebook"] as const;
export const VIDEO_PLATFORMS = ["tiktok", "instagram", "youtube"] as const;
export type PostingPlan = {
  text: Record<(typeof TEXT_PLATFORMS)[number], number>;   // posts a day, 0–3
  video: Record<(typeof VIDEO_PLATFORMS)[number], number>; // videos a week, 0–7
};
export const PostingPlanSchema: z.ZodType<PostingPlan>;
/** Connected text platforms at 1 a day; X at 1 when nothing is connected; video all 0. */
export function defaultPostingPlan(connected: readonly string[]): PostingPlan;
/** The core posts of one day: post i targets every platform whose count > i. [] when every count is 0. */
export function dayTargets(plan: PostingPlan): string[][];
```

SQL: `profiles.posting_plan jsonb` (null = use the default), `save_posting_plan(p_plan jsonb)` (user RPC, checks
the same bounds, `raise exception 'Posts a day must be between 0 and 3.'` etc.), granted to `authenticated` only.

- [ ] **Step 1: Write the failing checks** in `posting-plan.check.ts`:
  - `dayTargets({text:{x:2,threads:1,linkedin:1,facebook:0},video:…})` → `[["x","threads","linkedin"],["x"]]`
  - all zero → `[]`
  - `defaultPostingPlan([])` → `text.x === 1`, others 0; `defaultPostingPlan(["linkedin","tiktok"])` →
    `text.linkedin === 1`, `text.x === 0`, every video 0.
  - `PostingPlanSchema` rejects `x: 4` and `tiktok: 8`.
- [ ] **Step 2: Run** `cd apps/web && npx tsx lib/cmo/posting-plan.check.ts` → fails (module missing).
- [ ] **Step 3: Implement** `posting-plan.ts`.
- [ ] **Step 4: Write pgTAP** `299_posting_plan.test.sql`: owner saves a valid plan; `x = 4` raises; another user
  cannot write it; `anon` has no execute.
- [ ] **Step 5: Write the migration**, run `npm run db:reset && npm run db:test`, then `scripts/dump-schema.sh`.
- [ ] **Step 6: Commit** `CMO: a posting plan the founder sets — platforms, posts a day, videos a week`.

### Task 2: The planner screen and the week plan follow the posting plan

**Files:** create `components/today/PostingPlanPanel.tsx`, `app/api/v1/cmo/posting-plan/route.ts` (GET, PUT via
`save_posting_plan`), modify `components/today/CalendarView.tsx` (panel above the calendar),
`lib/screens/load.ts` (schedule screen reads `posting_plan` + connected accounts), `lib/cmo/jobs/plan-week.ts`.

**Interfaces — consumes:** Task 1's `PostingPlan`, `dayTargets`, `defaultPostingPlan`.
**Produces:** post items written by `plan_week` carry `body.targets: string[]` (platform ids) and
`platform` = the label of `targets[0]` (old readers keep working).

**UI:** one row per platform: name, connected or "Connect" link (`/app/settings#settings-connected-accounts`), a
stepper (text: "posts a day" 0–3; video: "videos a week" 0–7). Saves on change. A line under it states the cost in
plain words: "The CMO writes N posts a day and M video scripts a week."

**Week plan:** the code builds the skeleton, the model only fills ideas.
- Remove from the prompt the "Posts go to X unless…" rule and `WEEKLY_POSTS`.
- For each of the 7 days, `dayTargets(plan)` gives the post slots; the model receives the slot list
  (`day_offset`, `slot`) and returns one idea per slot. `normalize` drops ideas for slots not asked for and fills a
  missing one from the strategy pillars (as the fake does).
- Video: `plan.video[p]` items a week per platform, on days the model picks, department `video`, platform label
  (`TikTok`, `Reels`, `Shorts`).
- Slideshow items are no longer planned (D7).
- An item still `planned` and not drafted takes the new targets when the plan is saved (`save_posting_plan` updates
  `body.targets` of the founder's `planned` post items from today on; Review Focus 4).

- [ ] **Step 1: Failing check** in `lib/cmo/jobs/jobs.check.ts`: with plan `{x:1,linkedin:1}` the fake week plan has
  7 post items, each `body.targets = ["x","linkedin"]`; with `tiktok: 2` it has 2 video items labelled `TikTok`; no
  item labelled `Slideshow`.
- [ ] **Step 2: Failing pgTAP** in `299_posting_plan.test.sql`: saving a new plan rewrites `targets` of a `planned`
  item and leaves a `drafted` one alone.
- [ ] **Step 3: Implement** the route, panel and `plan-week.ts` changes; extend the migration of Task 1 only if it is
  not applied yet, else a new one `20270120015000_posting_plan_retarget.sql`.
- [ ] **Step 4: Run** `npx tsx lib/cmo/jobs/jobs.check.ts`, `npm run db:test`, `npm run typecheck`. All pass.
- [ ] **Step 5: Look at it:** `npm run dev`, open `/app/schedule`, set X 1 + LinkedIn 1 + TikTok 1, screenshot into
  `docs/plans/cmo/2026-11-12-daily-core-drafts-shots/`.
- [ ] **Step 6: Commit** `Planner: the founder picks platforms and counts; the week plan follows it`.

### Task 3: One core post a slot, fanned out to every target

**Files:** `packages/contracts/platforms.json`, latest `platform_profile()` (new migration
`20270120020000_post_targets.sql`), `lib/cmo/platforms.ts`, `lib/cmo/jobs/draft-post.ts`, `lib/cmo/schedule.ts`,
test `300_post_targets.test.sql`.

**Interfaces — produces:**
- A profile `{ id: "core", label: "Post", kind: "core", platform: null, limit: 3000, visibleBeforeMore: 140,
  hashtags: 0, links: false, tone: "A post of substance that stands on its own on X, LinkedIn and Facebook: the plain
  true line first, short paragraphs, one real story or lesson with its details. It may be long; it never pads." }`.
  `PROFILE_KINDS` gains `"core"`; `platform` is nullable only for `core`.
- X's profile `limit` becomes `25000` (D6).
- `postProfile(platform, targets?)` returns `core` when `targets` has more than one platform, else that platform's
  profile (a one-target post is still written for its platform: cheaper and better).
- SQL `post_targets(p_item uuid) returns text[]`: `body->'targets'` when present, else
  `array[platform_profile_id(platform)]` (Review Focus 5).
- `schedule_propose` for a post deliverable inserts one slot per `post_targets(item)` among
  `('x','threads','linkedin','facebook')`, `mode = 'publish'` with a connected account, else `'intent'`.

**Daily loop:** `enqueueDueDrafts` drafts one run per due **item** (not per platform): drop `duePerPlatform`, keep
`POST_RUNS_A_DAY = 3` (the planner's max per day). Rename the loop label `daily-x-draft` → `daily-post-draft`, and
keep `queuedToday` reading both names for one week so a day in flight is not drafted twice.

- [ ] **Step 1: Failing checks:** `lib/cmo/platforms.check.ts` — `postProfile("X", ["x","linkedin"]).id === "core"`,
  `postProfile("LinkedIn", ["linkedin"]).id === "linkedin"`, X limit 25000. `lib/cmo/schedule.check.ts` — three due
  items on X on the same day give three runs (today: one).
- [ ] **Step 2: Failing pgTAP** `300_post_targets.test.sql`: approving an item with targets `[x, linkedin]` and a
  connected X makes two slots: X `publish`, LinkedIn `intent`; an old item with `platform = 'Threads'` and no targets
  makes one Threads slot; no account at all → every slot `intent` (Review Focus 1).
- [ ] **Step 3: Implement**, `check:contracts`, dump schema.
- [ ] **Step 4: Run** `npx tsx` the two checks, `npm run db:test`, `cd apps/web && npm run check:contracts`,
  `npm run typecheck`.
- [ ] **Step 5: Commit** `Posts: one core post per slot, scheduled on every platform the planner picked`.

**Phase A done when:** with plan X 1 + Threads 1 + LinkedIn 1 and a fake brain, one cron day produces one post card,
and approving it produces three schedule cards. Write it as a step of `lib/screens/p6-acceptance.e2e.ts`.

### Task 4: Threads chain, long X posts, autopilot

**Files:** create `apps/web/lib/departments/publish/split.ts` + `split.check.ts`, modify `zernio.ts`,
`lib/cmo/jobs/publish-post.ts`, the schedule card (`components/today/…ScheduleCard`), the latest
`approvals_autopilot` trigger (new migration `20270120025000_autopilot_threads_chain.sql`), pgTAP in `298_…`-style new
file `301_autopilot_threads_chain.test.sql`.

**Interfaces — produces:**

```ts
/** Parts of at most `limit` characters, cut at a paragraph, else a sentence, else a word. Never an empty part. */
export function splitPost(text: string, limit: number): string[];
```

- Zernio: for `slot.platform === "threads"` and text over 500, send `platformSpecificData.threadItems` built from
  `splitPost(text, 500)`, media on item 0 (same shape as the X thread branch).
- Copy-and-open for Threads shows each part with its own Copy button.
- X failure: when Zernio's error says the text is too long, `publish_post` fails the slot with
  `"Your X account takes 280 characters per post. Post it as a thread, or turn on X Premium."` and the card offers
  **Post as a thread**, which re-publishes with `threadItems = splitPost(text, 280)` (Review Focus 2).
- Autopilot: a Threads slot whose text is over 500 characters gets no `auto_at` (a chain is a thread, D6). An X slot
  of any length may.

- [ ] **Step 1: Failing checks** `split.check.ts`: 500 chars → 1 part; 501 → 2; a 700-character sentence → word cuts,
  each part ≤ 500; emoji count as one character each (`[...text]`); no part empty or only whitespace.
- [ ] **Step 2: Failing checks** `zernio.check.ts`: a 900-char Threads slot sends 2 `threadItems`; `publish-post.check.ts`:
  a "too long" Zernio error on X gives the sentence above and `retry: "as_thread"`.
- [ ] **Step 3: Failing pgTAP** `301_…`: autopilot on Threads, 600-char post → no `auto_at`; 300-char → `auto_at` set;
  X 2000-char → `auto_at` set.
- [ ] **Step 4: Implement**, run the checks, `npm run db:test`, typecheck.
- [ ] **Step 5: Commit** `Publish: long Threads posts go out as a chain; long X posts go as one; a free X account gets a thread button`.

### Task 5: Facebook Page

**Files:** `lib/screens/common.ts` (`Platform` + `PLATFORM_LABEL.facebook = "Facebook"`),
`lib/departments/publish/types.ts` (`PUBLISH_PLATFORMS` + `"facebook"`), `zernio.ts` (`SLUG.facebook = "facebook"`),
`platforms.json` (profile `facebook`, kind `post`, limit 5000, tone "Warmer than LinkedIn, a story told to people who
know you; short paragraphs."), migration `20270120030000_facebook.sql` widening the platform checks of
`social_accounts`, `schedule_slots`, `account_metrics`, the `slot_platform_of` list and `platform_profile_id`.

- Settings → Accounts shows **Connect Facebook Page** with the line "Facebook posts only to a Page you manage. For your
  personal profile, the card gives you copy and open."
- Autopilot for Facebook stays off (not in the owner's autopilot list; widen only with the owner).

- [ ] **Step 1: Failing checks:** `accounts.check.ts` connects a fake `facebook` account; `zernio.check.ts` sends
  `platform: "facebook"`; pgTAP: a `facebook` slot inserts, a `facebook` autopilot setting is refused.
- [ ] **Step 2: Implement**, `check:contracts`, dump schema, run all.
- [ ] **Step 3: Commit** `Facebook Page: connect it, post to it; a personal profile gets copy and open`.

### Task 6: Every video script comes with its caption

**Files:** `lib/cmo/writer/types.ts` (`VideoBriefSchema` + `caption: z.string().trim().max(2200).default("")`),
`lib/cmo/writer/prompts.ts` (the script prompt asks for the caption: hook first line, ≤ 5 hashtags, no link),
`lib/cmo/writer/jobs.ts`, the script card and the Script tab (show the caption with Copy), and the finished-video
caption step (`lib/cmo/writer/video-source.ts`): when the edit came from a script, its caption is the first draft.

- The caption is written **in the same model call** as the script (no extra run, no extra credits).
- [ ] **Step 1: Failing check** `writer.check.ts`: the fake script has a non-empty `caption`, ≤ 2200, hashtags ≤ 5
  (`countHashtags`).
- [ ] **Step 2: Implement**, add the prompt to `no-ai-slop.check.ts` if it is a new prompt, run checks.
- [ ] **Step 3: Commit** `Scripts: the caption is written with the script`.

### Task 7: Repurpose on demand

**Files:** migration `20270120040000_post_variants.sql` (`post_variants(item_id, platform, text, run_id)`, RLS owner
read, writes by the runner only; `schedule_content(deliverable, platform)` prefers the variant), create
`lib/cmo/jobs/repurpose-post.ts`, register `repurpose_post` in `jobs/types.ts`, `capabilities.json` (1 credit,
`cmo_job_price`), a **Rewrite for <platform>** button per target on the post card, test
`302_post_variants.test.sql`.

- One Sonnet call, one version, the platform's profile and the core text as input; code checks only (no checker
  round). Price shown before running; refund on failure.
- [ ] **Step 1: Failing pgTAP:** a variant for LinkedIn changes LinkedIn's `schedule_content` text, not X's.
- [ ] **Step 2: Failing check** in `jobs.check.ts`: fake repurpose for `linkedin` saves one variant ≤ 3000.
- [ ] **Step 3: Implement**, add the prompt to `no-ai-slop.check.ts`, run all.
- [ ] **Step 4: Commit** `Posts: rewrite the core post for one platform, on request`.

### Task 8: Remove `build_slideshow`

**Files:** `lib/cmo/jobs/studio-orders.ts` (branch removed), `plan-week.ts` (constant `SLIDESHOW` removed),
`lib/screens/load.ts:1205` (only `build_post_image`), `packages/contracts/capabilities.json`,
`lib/departments/studio/slideshow/build.ts` (deleted), `slideshow.e2e.ts`, `e2e/ui-v2-slides.spec.ts`, migration
`20270120050000_drop_slideshow_order.sql` (`work_orders_plan_week` no longer creates it; queued ones are cancelled with a
refund through `credit_refund` if held). Keep `post-image.ts`.

- [ ] **Step 1:** `grep -rn build_slideshow apps packages supabase/migrations` lists only applied migrations after the change.
- [ ] **Step 2:** `npm run check:contracts`, `npm run typecheck`, `npm run build`, `npm run db:test` pass.
- [ ] **Step 3: Commit** `Remove the CMO-built slideshow; a slideshow is the founder's own photos`.

### Task 9: Photo post (TikTok Photo Mode, Instagram carousel)

**Files:** create `components/today/PhotoPostPanel.tsx` (opened from the calendar, not the editor),
`app/api/v1/photo-posts/route.ts` (reserve upload, create), migration `20270120060000_photo_post.sql` (deliverable kind
`photo_post`, `schedule_propose` for it; TikTok ≤ 35 photos, Instagram and Threads ≤ 20), a caption run
`photo_caption` (Haiku is not allowed for writing; Sonnet, 1 credit, the founder's words + the photo count, no vision).

- Photos upload through TUS with a reservation (never through Next.js). The founder orders them; the CMO writes the
  caption on request; the founder picks platforms; one slot per platform.
- [ ] **Step 1: Failing pgTAP:** 36 photos to TikTok is refused (`'TikTok takes up to 35 photos.'`); 21 to Instagram
  refused; a valid set makes one slot per platform.
- [ ] **Step 2: Failing check** `zernio.check.ts`: a photo post sends every photo as `mediaItems` type `image`.
- [ ] **Step 3: Implement**, look at it in the browser, screenshot, commit
  `Photo posts: upload your photos, get a caption, post as a carousel`.

### Rules and docs (with Task 3, the PR of Phase A)

- `CLAUDE.md` Product rules: add the owner decisions D1–D3, D6 (X autopilot may post long posts), D7, D9, dated
  2026-11-12. Update "Strategy" step "Writer (week plan, posts, slides…)" → "posts, video scripts with captions".
- `docs/architecture/ai-cmo.md` and its HTML twin: the posting plan and the fan-out.

## 4. Cost (why this is cheaper)

Today, X + Threads + LinkedIn every day is 3 draft runs a day (3 versions + checker each). With the core post it is 1
run a day for the same three platforms; Threads and X cost nothing extra (code splits), and a rewrite is paid only when
the founder asks. Video scripts cost what they cost today; the caption rides in the same call.

## 5. Not in this plan

- Autopilot for Facebook, video or photo posts (owner decision needed).
- Measuring which platform performs best and suggesting counts.
- Sales.
