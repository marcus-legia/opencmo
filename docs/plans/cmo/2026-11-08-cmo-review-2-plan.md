# CMO review 2: the AI CMO first, AI video hidden, docs that match the code, providers you can see, Sales that charges first

Branch `cmo-review-2` → `main`, one PR. Three sessions work on it at the same time:
[sessions](2026-11-08-cmo-review-2-sessions/).
Source: four research audits of `main` at `c5f0e13` (2026-11-08), re-read against `4f70a59` (#176–#180), the owner's
answers of 2026-11-08, and the owner's user-flow sketch of 2026-11-08 (§2).

## 1. Why

After #169–#180 the AI flow runs on Claude only, prompts are screened by Creem, and paid jobs charge once before they
run. The first production test on 2026-11-08 and the audits found the gaps below. The owner then changed the
strategy (§2): the AI CMO leads, and the editor comes last.

### 1.1 The docs describe a product that no longer exists

All eight pages in `docs/architecture/` still say "Status: proposed". Their "today" tables mark built work as
missing:
- work orders, approvals and their snapshot;
- Studio shorts, slideshow and post image, plus the finished state;
- Zernio publishing on six platforms, and the look check;
- writers for every platform, no-ai-slop on every writing prompt;
- the progress check, the event rules and the budget gate.

They are also wrong about several things:
- **Providers:** they name Gemini and Groq, say the checker runs "on another provider", and describe LLM prompt moderation.
- **Video:** they show `/video` as two cards with a contact sheet, and still list 3D, `animate_video` and `render_three`.
- **Counts:** 12 agents (there are 20) and 8 job kinds (there are 12).
- **Order:** they rank work by the editor strategy, which the owner replaced on 2026-11-08 (§2).

Built but not documented at all:
- `credit_orders` and one-card jobs, keyframe chaining, turn overage billing, the Studio holds;
- Creem moderation, `plan_explainer`;
- the provider spend ledger and the Costs page.

`ARCHITECTURE.md` §11 is stale as well. The fix was already planned as B6 in
[`2026-11-04-cmo-review-plan.md`](2026-11-04-cmo-review-plan.md) and never done.

The "OpenCMO Agent Team" artifact (https://claude.ai/artifact/93Bja2KhKZp15KpyBKwDPs, 2026-11-05) is out of date too:
- it still draws web moderation as a Haiku prompt check;
- its "open" list is mostly done;
- it has nothing on the charge-before-running flow.

### 1.2 A new founder hits walls before the CMO does anything

1. **The landing page says "Start free", but signup gives 0 credits.** The "Continue in Claude" fallback needs an API
   key, and API keys are for paid accounts only.
2. **The first screen is a 5-step setup** (`components/screens/setup/SetupScreen.tsx`):
   - the Connect step is a disabled button;
   - Brand Kit sends the founder to another page;
   - the goal often arrives with the nightly plan, so the first plan and drafts can come the next morning.
3. **The landing page and the editor sell AI video first.** The editor pitch, `/video` and generated shots are the
   most expensive and most complex part of the product. A default `/video` costs roughly 90–120 credits
   (`lib/agent/create-video.ts` `pickShotModel`, catalogue prices; an estimate from the code, not a measurement).
4. **The week plan orders a one-minute AI video** (`lib/cmo/jobs/plan-week.ts:35`, `:151`), so the CMO's own loop
   runs into the most expensive job.
5. **Dead ends:**
   - disabled buttons that say "arrives with…";
   - an upload is aborted without warning when the founder navigates away (`UploadPanel.tsx`);
   - a failed transcript shows as "no speech";
   - posting one X draft with no connected account takes three cards and fails at the scheduled time.

### 1.3 Providers are wired, but production cannot see when one breaks

- The 2026-11-08 production test failed on `401 invalid x-api-key` from Anthropic. Nothing in the app said so: the
  Costs page (`lib/ops/switches.ts`) has no row for Anthropic, fal, ElevenLabs or motion.
- `check_deploy_env.py` does not cover Creem, ScrapeCreators, Zernio, Resend or VAPID.
- fal and ElevenLabs spend is recorded without a price.
- The ScrapeCreators response parsers have never been checked against a real response (`lib/cmo/social/scrapecreators.ts:6-9`).
- `.env.example` is missing several variables the code reads.

### 1.4 Sales breaks "charge before running"

- The CMO chat starts a 5-credit scan with `create_task{agent:"sales"}` and shows no card.
- "Add N credits and finish" is a disabled button (`components/screens/sales/SalesScreen.tsx:105`).
- The Sales screen has no way to start a scan.
- The multi-platform lead finder ([spec](2026-10-31-sales-finder-spec.md) F1–F10) is not built, and waits on R0.

## 2. Owner decisions (2026-11-08)

### 2.1 The AI CMO first, the editor last

This replaces "the editor is the spearhead" (2026-10-19). After testing, the owner found the editor too complex and
too expensive to lead: the AI CMO makes value at a small cost (tokens), so it leads.

The product follows the owner's sketch, top to bottom. Words are written before anything is built from them:

| # | Step | What happens | Built in |
|---|---|---|---|
| 1 | Business information | The CMO reads the website and writes the four documents | `lib/cmo/onboard.ts`, `site.ts`, `documents.ts` |
| 2 | Writer | The week plan, post drafts (text for X, Threads, LinkedIn…; slides and images for TikTok, Instagram), video scripts and storyboards; every word through no-ai-slop | `plan-week.ts`, `draft-post.ts`, `draft-thread.ts`, `write_slides`, `write_video_brief`, `lib/cmo/platforms.ts` |
| 3 | Approval 1 | The founder approves the plan and the words | `approvals` |
| 4 | Video | Built from the approved words, with the Brand Kit: slideshow, post image, short clips cut from a finished edit of the founder's own video. The editor is where the founder fine-tunes by hand, at the end | `lib/departments/studio/{slideshow,shorts}`, `lib/brand.ts`, the editor |
| 5 | Approval 2 | The founder approves what was made | `approvals` |
| 6 | Post | Schedule and publish text, slideshows, videos with captions, clips; captions and hashtags per platform | `schedule.ts`, `lib/departments/publish`, `write_caption` |

The order of work follows the same rule. Rank work by one question first: **does it make the CMO loop above (steps
1–6) work for a paying founder, end to end?** Editor work comes after, unless the owner says otherwise.

### 2.2 AI video is hidden for now

The editor stays as it is. **Generation with a video model is hidden** from every place a founder finds it:
- the slash menu and its starters: `/video` (`create_video`), `/animate`, `/edit` (`edit_video`) and `/background`
  (`replace_background`), once S2.4 confirms which of them call a video model;
- the animation step of `/broll` (stills only);
- the landing page, the pricing copy and the FAQ;
- the week plan (no AI video item; §1.2.4).

The code, the tools and the evals stay (no deletion). The MCP server keeps its tools. Hiding is one switch in one
place, so turning AI video back on is one change. Every other slash command stays: `/style`, `/image`, `/broll`
(stills), `/intro`, `/voiceover`, `/music`, `/roughcut`, `/explain`.

### 2.3 The other decisions

- **Paid first.** Signup keeps 0 credits. The landing page and the flow say so honestly. There is no free trial.
- **Sales:** fix what exists. The new lead types wait for R0 (whether platform terms allow a paid product to read them).
- **Articles** (the sketch's "article draft" and "post article") are not in this plan. They come after the loop
  works for posts, slides and clips.
- **Not decided here** (listed in the PR for the owner):
  - Vercel Hobby. Its 300 s request limit forced the step cut in #178, and its terms for commercial use apply to a
    paid product.
  - The Creem account review, after the live moderation calls.

## 3. Sessions

| Session | Scope | Owns (summary) | Waits on |
|---|---|---|---|
| [S1 Docs](2026-11-08-cmo-review-2-sessions/S1-docs.md) | Architecture pages in the CMO-first order, `ARCHITECTURE.md` §11, spec §8, the Agent Team artifact | `docs/architecture/**`, `ARCHITECTURE.md`, two plan docs | nothing; reads S2/S3 commits at the end |
| [S2 CMO first](2026-11-08-cmo-review-2-sessions/S2-activation.md) | Paid-first entry, the CMO's first week within minutes, AI video hidden, the week plan without AI video, dead ends, legal and price copy, dead code | landing, setup, shell nav, `plan-week.ts`, editor, `clipScope` in `scope.ts`, `slash.ts`, `guides.ts`, cards, legal pages, `pricing.ts` | nothing |
| [S3 Ops and Sales](2026-11-08-cmo-review-2-sessions/S3-ops-sales.md) | Costs page live checks, deploy check, `.env.example`, provider prices, ScrapeCreators fixtures, the Sales price card and buttons, small billing fixes in SQL | `lib/ops`, Costs page, `deploy_env.py`, `.env.example`, **all migrations and `current.sql`**, `cmoScope` in `scope.ts`, `cmo-tools.ts`, Sales screen and job, `lib/cmo/social` | nothing |

Rules for all three sessions: [sessions README](2026-11-08-cmo-review-2-sessions/README.md).

## 4. Done when

- A paying founder signs in, pays, gives the website, and within 10 minutes sees the week plan and the first drafts.
  They approve one post and schedule it, and a slideshow card arrives. One card per job and no dead end. Measured in
  clicks and minutes on a preview deployment.
- No screen, starter, slash menu, landing section or week plan offers AI video. The editor, upload and the other
  slash commands work as before.
- Every page in `docs/architecture/` matches the branch and the order of §2.1, and the Agent Team artifact is
  republished at the same URL.
- The Costs page shows a red row for a bad Anthropic, fal, ElevenLabs, Creem or ScrapeCreators key.
- No Sales scan spends credits without a card.
- `npm run typecheck`, `check:contracts`, the Assistant eval, pgTAP, engine `pytest` and `ruff` are all green on the PR.

## 5. Not in this plan

- Free trial credits (the owner chose paid first).
- Articles (§2.3).
- New Sales lead types and creators (they wait on R0).
- Making AI video cheaper, and showing it again. That gets its own plan once the CMO loop works.
- Fewer cards a week: the sketch has two approvals (the words, then what was made); today a week is about 15–20 cards
  (`workflow.md` §3). This gets its own plan after S2, together with one Assistant replacing the CMO chat, the Editor
  Assistant and the Studio entry points, and removing the v1 UI.
- Model or provider changes.
