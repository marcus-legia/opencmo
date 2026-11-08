# CMO review 2: docs that match the code, paid-first activation, providers you can see, Sales that charges first

Branch `cmo-review-2` → `main`, one PR. Three sessions work on it at the same time:
[sessions](2026-11-08-cmo-review-2-sessions/).
Source: four research audits of `main` at `c5f0e13` (2026-11-08), re-read against `4f70a59` (#176–#180), plus the
owner's answers of 2026-11-08.

## 1. Why

After #169–#180 the AI flow runs on Claude only, prompts are screened by Creem, and paid jobs charge once before they
run. The first production test on 2026-11-08 and the audits found four gaps.

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

### 1.2 A new founder hits walls before the editor does anything

1. **The landing page says "Start free", but signup gives 0 credits.** An upload holds 10 credits and an Assistant
   request 5. The "Continue in Claude" fallback needs an API key, and API keys are for paid accounts only.
2. **The first screen is a 5-step CMO setup** (`components/screens/setup/SetupScreen.tsx`):
   - the Connect step is a disabled button;
   - Brand Kit sends the founder to another page;
   - the goal often arrives with the nightly plan, so the first output can come the next morning.
3. **The Editor is the last item of an 11-item rail** (`components/shell-v2/nav.ts`). A blank edit offers
   talking-head starters and no `/video` or `/explain` (`components/editor/assistant/AssistantPanel.tsx`).
4. **`/video` picks the most expensive shot model and 30 s by default** (`lib/agent/create-video.ts`
   `pickShotModel`). From the catalogue prices that is roughly 90–120 credits a video. This is an estimate from the
   code, not a measurement.
5. **`/broll` takes two cards** (stills, then animation) and prices three variants at full price each
   (`lib/agent/guides.ts`). That breaks "charge once".
6. **Dead ends:**
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

- **Paid first.** Signup keeps 0 credits. The landing page and the flow say so honestly. There is no free trial.
- **Sales:** fix what exists. The new lead types wait for R0 (whether platform terms allow a paid product to read them).
- **Order:** docs first, then activation, then providers and ops, then Sales. The sessions below run in parallel, and
  each keeps that order inside its own list.
- **Not decided here** (listed in the PR for the owner):
  - Vercel Hobby. Its 300 s request limit forced the step cut in #178, and its terms for commercial use apply to a
    paid product.
  - The Creem account review, after the live moderation calls.

## 3. Sessions

| Session | Scope | Owns (summary) | Waits on |
|---|---|---|---|
| [S1 Docs](2026-11-08-cmo-review-2-sessions/S1-docs.md) | Architecture pages, `ARCHITECTURE.md` §11, spec §8, the Agent Team artifact | `docs/architecture/**`, `ARCHITECTURE.md`, two plan docs | nothing; reads S2/S3 commits at the end |
| [S2 Activation](2026-11-08-cmo-review-2-sessions/S2-activation.md) | Paid-first entry, editor first, `/video` and `/broll` cards, dead ends, legal and price copy, dead code | landing, setup, shell nav, editor, `clipScope` in `scope.ts`, `create-video.ts`, `generate-tool.ts`, `guides.ts`, `slash.ts`, cards, legal pages, `pricing.ts` | nothing |
| [S3 Ops and Sales](2026-11-08-cmo-review-2-sessions/S3-ops-sales.md) | Costs page live checks, deploy check, `.env.example`, provider prices, ScrapeCreators fixtures, the Sales price card and buttons, small billing fixes in SQL | `lib/ops`, Costs page, `deploy_env.py`, `.env.example`, **all migrations and `current.sql`**, `cmoScope` in `scope.ts`, `cmo-tools.ts`, Sales screen and job, `lib/cmo/social` | nothing |

Rules for all three sessions: [sessions README](2026-11-08-cmo-review-2-sessions/README.md).

## 4. Done when

- Every page in `docs/architecture/` matches `main`, and the Agent Team artifact is republished at the same URL.
- A paying founder signs in, pays, lands in the editor and gets a 15 s `/video` and an export, with one card and no
  dead end. Measured in clicks and minutes on a preview deployment, and checked by looking at an exported frame.
- The Costs page shows a red row for a bad Anthropic, fal, ElevenLabs, Creem or ScrapeCreators key.
- No Sales scan spends credits without a card.
- `npm run typecheck`, `check:contracts`, the Assistant eval, pgTAP, engine `pytest` and `ruff` are all green on the PR.

## 5. Not in this plan

Free trial credits (the owner chose paid first). Articles. The new Sales lead types and creators (they wait on R0).
One Assistant replacing the CMO chat, the Editor Assistant and Studio entry points, and removing the v1 UI: their own
plan, after S2. Model or provider changes.
