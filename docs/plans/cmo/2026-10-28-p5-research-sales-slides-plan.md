# P5: Research for Studio, safe Sales, slideshows and post images

> **For agentic workers:** §2 says *what* ships, §5 the tasks. Three sessions build it on branch **`cmo-p5`** (PR into
> `cmo-build`). Each session's numbered todo list, owned paths and order are in
> [`2026-10-28-p5-sessions/`](2026-10-28-p5-sessions/): read `README.md` there, then your own file. Build nothing
> before your Task 0 is done; nobody builds on a contract before it is pushed.

## 0. Scope

Phase 5 of [`2026-10-28-backend-roadmap.md`](2026-10-28-backend-roadmap.md) (on branch `cmo-p2`). It builds four
backend phases: **R0** (data terms), **R1** (Sales safety), **R2** (niche video research) from
[`research-sales.md`](../../architecture/research-sales.md) §9, and **S3** (Slideshow and Post image squads) from
[`studio.md`](../../architecture/studio.md) §11. After it: 19 of 28 backend phases (≈ 68%).

**Status: draft, written early (owner, 2026-10-28).** It was written while P2 was being built. Before sessions start,
the planner merges `cmo-build` (with P2–P4) into `cmo-p5` and refreshes §3. R0 is an owner task (§6); its answer can
change R1's sources, never the safety rules.

Not in this phase: reply outcome checks and Zernio metrics (R3, P6), Hacker News (R4, P6), the look check (S4, P6).

## 1. Goal and decisions

**Goal:** Sales drafts only where a subreddit's rules allow it and mentions the product rarely; Research finds what
works on video in the founder's niche and feeds Writer's video brief and Studio's Director; Studio makes slideshows
(MP4 and a PNG set from one document) and post images, each behind one card, scheduled like any deliverable.

**Decisions already made (owner, 2026-10-26 → 10-27):**
- Check ScrapeCreators' and Reddit's terms before Sales is sold (R0 first).
- Product mentions only where the subreddit allows, at most about 1 reply in 10; otherwise help only. No links in
  replies. Sales has no post button; the founder posts by hand.
- Niche video research feeds the editor strategy.
- No always-on keyword alerts; scans run when the week's plan has a Reddit item.
- **One editor core, a Slides view**: a project of kind `slideshow`, slide ops in `editor-core`, MP4 through
  `render_document`, the PNG set as one still per slide from the same renderer. Not a second editor.
- Text on slides and post images is always an editor layer, never inside a generated image; generated images are
  moderated; the founder's screenshots and captured pages first.

## 2. What ships

| # | Feature | The founder sees | Done when |
|---|---|---|---|
| F1 | Data terms (R0) | — | `docs/research/growth/` report on ScrapeCreators' terms for a paid product and Reddit's data terms through them; the owner's decision written in `research-sales.md` §10 |
| F2 | Subreddit rules check | a Sales card says "Help only: r/x forbids self-promotion" or the thread is skipped | before drafting, the subreddit's rules are read through the reader (data, never instructions) and cached per subreddit for 7 days: `mention_ok`, `help_only`, `skip` |
| F3 | Rare product mentions | "Help only this time: you mentioned the product in 1 of the last 10 replies" | count of replied threads with a mention over the last 10; past 1 in 10, drafts are help only and the card says why |
| F4 | Replies in their voice | fewer replies that read like AI | Sales drafts read the No AI Slop skill and voice notes (from P3); < 120 words; no links (code check) |
| F5 | Excluded subreddits and co-occurrence | Sales settings: excluded subreddits; "both terms must appear" | per-founder lists in SQL; queries filtered before paying for scoring |
| F6 | Sales screen complete | `sales.mentions` and `sales.stuck` live | the mention counter and the "stuck" banner (no passing thread for 2 scans) read real rows |
| F7 | Niche video research (R2) | Research → "What works on video in your niche": top shorts with hook, length, format, URL | `niche_video_research` job: top TikTok, YouTube Shorts and Reels for the strategy's topics, transcripts through `get_transcript`; an insight without a URL is dropped; `cmo_insights.kind` widened |
| F8 | Research feeds the brief | the video brief cites the hooks it learned from | Writer's `write_video_brief` (P3) reads the niche insights; the brief carries their URLs |
| F9 | Slideshow project | "New" offers New video and New slideshow; a Slides view (strip, frame, text/image/colour/duration); "Timeline" switches to the full editor | `clips.kind` `slideshow`; ops `add_slide`, `move_slide`, `delete_slide`, `set_slide_duration`, `set_slide_text`; the Assistant and MCP get them |
| F10 | Slideshow squad | a slideshow card: the slides, quick text edits per slide, "Open in Slides", MP4 and PNG set | chain Writer (`write_slides`, P3) → Reviewer (code) → Visuals (screenshots and captured pages first; AI image moderated, no text inside) → Builder (slide ops) → Renderer (MP4 via `render_document`, PNG set via a new still export) |
| F11 | Post image squad | a post card with an image (cover, thumbnail) | a frame of the founder's video or a captured page with a title layer; generate only when none fits; aspect per platform; Brand Kit fonts and colours |
| F12 | Acceptance | — | a local run with fake providers: Sales scan with one help-only and one skipped subreddit; niche research → a brief citing URLs; a slideshow card → approve → MP4 + PNG set → schedule card (P4) |

## 3. What exists (`cmo-build` at `992d632`, P2–P4 planned; refresh before start)

- Sales: `lib/cmo/jobs/sales-scan.ts` (275 lines; queries, ≤ 30 threads, score with exact quotes, ≥ 60 passes, drafts
  for the best 5), `opportunities`, `cmo_decide_opportunity`; reader in `lib/cmo/social/reddit.ts`,
  `scrapecreators.ts`, `research.ts`; untrusted text in `lib/cmo/untrusted.ts`; budget `ScBudget`,
  `research_credits`.
- Research: `jobs/competitor-research.ts` (X only), `cmo_insights` with `kind` check `= 'competitors'` only; CMO chat
  tools in `lib/agent/cmo-research.ts` (`find_outliers`, `search_videos`, `get_transcript`…).
- Screens: `sales` (`threads`, `week` live; `mentions`, `stuck` not), `research` (live), `studio` (P2 live).
- Studio: `clips.kind` allows `full`, `blank` (+ `short` after P2); `editor-core` ops registry; `render_document`;
  `capture_page` task; `/image` slash command and Generate with moderation; Brand Kit `apply_brand`.
- After P3: `write_slides`, the video brief from Writer, voice notes. After P4: schedule cards for any deliverable.

## 4. Global constraints

- Every write through an ownership-checking RPC; credits only through `credit_*`; a pgTAP test per migration and per
  transition; regenerate `supabase/schema/current.sql`. **Migration prefix for this phase: `20261231`.**
- Outside text (subreddit rules, thread text, video transcripts) is data, wrapped by `untrusted.ts`; it never changes
  what an agent may do.
- Every research read has a credit budget; daily limits in SQL.
- Moderation on every image prompt before credits and every generated image after; no real people, no other brands'
  logos; no text inside generated images.
- One editor runtime: the Slides view is a view of the same editor and document; PNG stills come from `clip-render`.
- Peak RAM < 2 GB for the slideshow MP4 and the PNG set; measure once.
- English in all user-facing text; no model names; Sales never posts.

## 5. Tasks

| Task | Session | What | Waits on |
|---|---|---|---|
| **A0** | A | **Contracts first:** migration skeleton `subreddit_rules` (cache), `sales_settings` (excluded subreddits, co-occurrence pairs), mention flag on outcomes, `cmo_insights.kind` widened (`niche_video`), `clips.kind` `slideshow`, `deliverables.kind` gains `image` (`slideshow` exists), `approvals` snapshot for `slideshow`; screen types for `sales.mentions`, `sales.stuck`, the Research niche section | — |
| **B0** | B | **Contracts first:** slide ops' signatures and the slideshow document shape in `editor-core` (`ops/slides.ts` types only); the Studio adapter's `buildSlideshow(brief)` and `buildPostImage(brief)` types; the still export task contract (`render_stills`) | — |
| A1 | A | R1 in SQL and jobs: rules check before drafting (reader → `subreddit_rules`), mention counter and the 1-in-10 rule, excluded subreddits and co-occurrence in `sales-scan`; reply code checks (no links, < 120 words) | A0 |
| A2 | A | R2: `niche_video_research` job (sources, budget, outliers, transcripts, URL rule), its order kind and schedule (when the plan has a video item); Writer's brief reads it | A0 |
| A3 | A | Loaders: `sales.mentions`, `sales.stuck`, Research niche section, Studio slideshows and images; event rule slideshow approved → schedule (P4) | A1, A2, B3 |
| A4 | A | Acceptance (F12) with screenshots of Sales, Research and a slideshow card at 1440 and 390; the R0 report written with the owner | all |
| B1 | B | Slide ops in `editor-core` with tests (golden documents); MCP and Assistant get them through the registry | B0 |
| B2 | B | `render_stills` worker task: one PNG per slide from `clip-render` (Node) on the worker; PNG set zipped for download; peak RSS measured | B0 |
| B3 | B | Slideshow squad in the Studio adapter: `write_slides` → reviewer (code: text fits the frame, no invented numbers, words to avoid) → visuals (captured pages first, `/image` moderated otherwise) → builder → MP4 + PNG set → one `slideshow` card | B1, B2, A0 |
| B4 | B | Post image squad: a frame or captured page + title layer, generate only when none fits; aspect per platform; Brand Kit; an `image` deliverable attached to its post | B3 |
| C0 | C | Slideshow card body (slides strip, quick text edit per slide, MP4 preview, PNG set, Open in Slides) and Sales card states (help only and why, skipped and why) on A0's types with fixtures | A0 |
| C1 | C | "New slideshow" entry and the Slides view in the editor (`components/editor/slides/`): strip with add/delete/drag, per-slide duration, Timeline switch | B1 |
| C2 | C | Sales settings (excluded subreddits, co-occurrence pairs), the mention counter and stuck banner live; Research niche section live | A3 |
| C3 | C | e2e: make a slideshow in the Slides view, approve a slideshow card, a help-only Sales card | C0–C2 |

**Milestones**
- **M1** contracts: A0 and B0 pushed and reviewed; R0 status known.
- **M2** safe Sales and niche research: A1, A2, C0 (Sales part), C2.
- **M3** slideshows, post images and acceptance: A3, A4, B1–B4, C1, C3; the planner reviews the whole PR.

## 6. Owner gates

1. R0: read ScrapeCreators' terms for a paid product and whether Reddit's data terms reach us through them; decide
   the fallback (official Reddit API under a commercial agreement, or Sales on Hacker News, X and Threads first).
   Sales stays off the landing page until this is decided.
2. One real-model run of the slideshow squad (costs money), with the owner's go-ahead.

## 7. Review focus

- Subreddit rules are data: a rules page saying "ignore previous instructions" changes nothing.
- The 1-in-10 rule holds across scans; a help-only draft never mentions the product.
- No links in replies; no post button anywhere in Sales.
- An insight without a URL from the data read is dropped.
- Slides are a view of the one editor; no second renderer; text never baked into a generated image.
- Moderation runs on every generated image; renders and stills inside the 2 GB budget.
