# Session S3: providers you can see, and Sales that charges first

Plan: [`../2026-11-08-cmo-review-2-plan.md`](../2026-11-08-cmo-review-2-plan.md) · rules: [`README.md`](README.md).

## Research notes

- **S3.1.** Now: `lib/ops/switches.ts` only says whether a variable is set; the Costs page
  (`app/app/settings/costs/page.tsx`) has no row that calls a provider, so the 401 of 2026-11-08 showed nowhere.
  Change: `lib/ops/providers.ts`, one row per provider with the cheapest authenticated read, cached 5 minutes per
  instance and checked again at once when a key changes:
  - Anthropic `GET /v1/models?limit=1`; ScrapeCreators `GET /v1/credit/balance`; Creem `POST /v1/moderation/prompt`
    with a fixed safe sentence (sandbox URL for a test key, as `lib/creem.ts`);
  - fal `GET https://api.fal.ai/v1/account/billing` (free; a key without the Admin scope answers 403, so only 401 is
    "invalid");
  - ElevenLabs `GET /v1/user/subscription` (a restricted key without `user_read` answers 401 `missing_permissions`,
    which is a known key);
  - motion has no live call (the preview endpoint runs scene code): configuration only, and `OPENCMO_MOTION=local` in
    production is called out;
  - the Anthropic row also reads `llm-health.ts`: a real call that failed on the key since the check wins.
  Check: `lib/ops/providers.check.ts` (a key set to `x` is "invalid key" for every live row; no key reaches the page).
- **S3.2.** Now: `opencmo/deploy_env.py` compares tokens shared by Vercel and Modal, but has no Creem key, and no
  rule for the Vercel-only features (Zernio, Resend, VAPID, ScrapeCreators); `.env.example` misses
  `SUPABASE_JWT_SECRET`, `OPENCMO_WEB_URL`, `OPENCMO_LOOK_*`, Zernio, `NEXT_PUBLIC_OPENCMO_UI`, `OPENCMO_CMO_PAUSED`, and
  still says moderation runs on a Haiku agent. Change: the Creem key is shared by Vercel and `opencmo`, and its
  fingerprint carries its mode (test/live), so different modes are named and a test key on Vercel production is a
  problem. `FEATURES` lists the Vercel-only features: off is a note; switched on (`OPENCMO_PUBLISH_LIVE`,
  `OPENCMO_EMAIL_LIVE`) without its keys, or half a VAPID pair, is a problem. Limit: a Vercel Sensitive value comes back
  empty, so its mode cannot be read there (it is then listed with the unreadable ones). Check:
  `tests/test_check_deploy_env.py`.
- **S3.3.** Now: the worker records fal and ElevenLabs as `<model id>:<unit>` (`opencmo/ai/spend.py`,
  `worker/generate_task.py:329`), and `provider_prices` has only the ScrapeCreators row, so every media row is
  unpriced. Change: migration `20270111010000_media_provider_prices.sql`, the list prices of 2026-11-08 for 12 units,
  each PROVISIONAL until an invoice confirms it; seconds without model audio; ElevenLabs effects and music (recorded
  once per generation) at their longest length. Unpriced on purpose, no price found: `gemini-voice`, `fal-kling-edit`,
  `fal-seedvr-upscale`, `fal-veed-cutout`. Not recorded at all yet (out of scope, a note for the owner): Scribe
  transcripts and the fal NSFW check. Data only, so `current.sql` does not change. Check:
  `supabase/tests/257_media_provider_prices.test.sql`; the migration applied twice is a no-op.
- **S3.4.** Now: the parsers in `lib/cmo/social/scrapecreators.ts` read candidate paths that were never checked against
  a real answer (`scrapecreators.ts:6-9`); `research.check.ts` tests them on hand-written single objects. Change:
  `lib/cmo/social/fixtures/endpoints.ts` lists the 15 endpoints `research.ts` reads, each with the reader that reads it;
  `scripts/scrapecreators-fixtures.mts` calls each once through that reader with the real key, chains links (a thread
  from the search, a video from a search), redacts people (names, ids, avatars, emails, also inside links and text),
  and saves `fixtures/scrapecreators/<name>.json`; `fixtures.check.ts` feeds each saved body to the same reader.
  **The 15 fixtures are `assumed` for now:** `docs.scrapecreators.com` and the API do not resolve from the build
  sandbox, so they were written from the paths the parsers read, which proves the plumbing, not the provider's shape.
  The check prints how many are real. Owner: run the script (header has the command) and commit the result.
- **S3.5.** Now: `cmoScope.plan()` (`scope.ts`) returns `run` for `create_task`, so `create_task{agent:"sales"}`
  queues a 5-credit scan with no card (`cmo-tools.ts`, `case "create_task"`). Change: `pricedTaskCard()` in
  `cmo-tools.ts` plans a run-now `sales` (`sales_scan`, 5) or `research` (`competitor_research`, 2) task as an approval
  card with the price from `JOB_PRICES` and what it will search; `decide()` runs the task as it was on the card, and a
  Cancel spends nothing. Drafts and plans (1 credit) still run at once; a dated task is a calendar item and costs
  nothing until its day; the weekly loop keeps its budget gate. `niche_video_research` is not reachable from
  `create_task`, so nothing to gate there. The CMO eval's memory-safety grade no longer counts a price card as a planted
  decision (`eval/cmo-tasks.ts`, `eval/cmo-run.ts`). **Open:** MCP calls `create_task` directly (`lib/cmo/mcp/cmo.ts`)
  and has no cards; a scan asked over MCP still runs at once. Its quote → confirm step (as `generate_media`) is a
  follow-up for the owner to rank. Check: `lib/agent/cmo-priced-task.check.ts`; `agent:eval --provider fake` CMO 7/7.
- **S3.6.** Now: the Sales screen cannot start a scan, and "Add N credits and finish" is disabled
  (`SalesScreen.tsx:105`). Research: a scan holds its 5 credits in `enqueue_cmo_run` before it starts and runs in one
  go; the live loader (`lib/screens/load.ts`, `stuck`) only reports "two scans found nothing" (`found: 0`), so the
  button only ever showed on the sample fixture. There is no stopped scan to finish, so no clean budget path: **the
  button is removed**, and the sample fixture says what the live banner says. Change: a Scan now button opens the same
  price lines as the chat card (`lib/cmo/jobs/price-card.ts`, shared with `pricedTaskCard`), and Approve calls
  `POST /api/v1/cmo/runs {kind: "sales_scan"}`, the existing path (credits held in `enqueue_cmo_run`, brain mode
  honoured). No migration needed. `e2e/cmo.spec.ts` now approves the chat's scan card (not run here: no Supabase
  stack in the sandbox; CI runs it). `SalesScreen.stuck.creditsToFinish` is now unread; left in the schema for S1/S2
  to drop with the screen contract if they want.
- **S3.7.** Migration `20270111020000_billing_review_fixes.sql`, test `258_billing_review_fixes.test.sql` (it fails
  4 of 9 without the migration):
  - `agent_close_turn` (body of `20270110010000`): the settle row is "Assistant usage" when the turn used more than it
    held, "Assistant refund" when it used less.
  - `studio_order_release_hold`: when an order ends, the usage its allowance covered (`least(used, hold)`, the hold read
    from its own "CMO video team hold" rows) goes through `work_order_spend`, so the order and its week count it.
    Usage past the hold was already counted by `studio_record_usage`.
  - **`credit_order_draw` is not changed: owner decision needed.** A draw writes two rows (the job's hold returned,
    the piece's hold taken) because a ledger row carries one `(ref_kind, ref_id)` and `credit_held` sums by it. One row
    cannot move credits between two holds without changing the money primitives (CLAUDE.md web rule 5). Two ways out,
    for the owner to pick: (a) the Credits page (`app/app/billing/page.tsx`, reads the last 30 `credit_ledger` rows)
    reads a view that folds each draw pair into one line, with no change to money; or (b) a primitive that moves a
    hold, with its own pgTAP. (a) is smaller and touches no money path.
  - S2 asked for no Creem-cancel change, so none is here.
  - Tested on a local Postgres 16 with the Supabase roles stubbed (no Docker in the sandbox): every migration applies,
    166 of 167 pgTAP files pass, and the one failing file (`249_cmo_review_plan_card`) fails the same way before these
    changes. CI's run is the authoritative one.

## You own

- `supabase/migrations/*` from `20270111010000` up, new `supabase/tests/2*`, and `supabase/schema/current.sql`.
- Ops:
  - `apps/web/lib/ops/**`;
  - `apps/web/app/app/settings/costs/**`;
  - `apps/web/lib/llm-health.ts`;
  - `apps/web/lib/spend/**`.
- Env:
  - `apps/web/.env.example`, `packages/engine/.env.example`;
  - `packages/engine/opencmo/deploy_env.py`, `packages/engine/check_deploy_env.py`, and their tests.
- Social: `apps/web/lib/cmo/social/**`, plus new fixtures and checks for it.
- CMO side of the agent:
  - `apps/web/lib/agent/scope.ts` from `cmoScope` down;
  - `cmo-tools.ts`, `cmo-research.ts`, `cmo-decisions.ts`.
- Sales:
  - `apps/web/components/screens/sales/**`;
  - `apps/web/app/api/v1/sales/**`;
  - `apps/web/lib/cmo/jobs/sales-scan.ts`, `apps/web/lib/cmo/jobs/start.ts`, `apps/web/lib/cmo/jobs/progress.ts`.

## Order

S3.1 → S3.2 → S3.3 → S3.4 → S3.5 → S3.6 → S3.7.

Migrations, in this order, each with its own pgTAP test and the dump regenerated:
1. S3.3: provider prices.
2. S3.6: Sales hold raise, if one is needed.
3. S3.7: billing fixes.

## Todo

- [x] **S3.1 Costs page: one live row per provider** (`lib/ops/switches.ts`, `app/app/settings/costs`).
  - Rows: Anthropic, fal, ElevenLabs, motion, Creem, ScrapeCreators, next to the existing ones.
  - Each row runs a cheap live check, server side, cached for a few minutes, and never prints a key:
    - Anthropic: `GET /v1/models`;
    - ScrapeCreators: `/v1/credit/balance`;
    - Creem: moderation of a fixed safe prompt;
    - fal and ElevenLabs: the cheapest authenticated read their APIs offer. Find it first.
  - Each row shows one of "not set", "invalid key", "test key in production" or "ok". Reuse `lib/llm-health.ts`.
  - Check: a key set to `x` shows "invalid key".
- [x] **S3.2 Deploy check and `.env.example`.**
  - `deploy_env.py` / `check_deploy_env.py`:
    - check that the Creem key mode is the same on Vercel and the `opencmo` worker;
    - list ScrapeCreators, Zernio (`ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, `OPENCMO_PUBLISH_LIVE`), Resend and VAPID.
  - Add to both `.env.example` files: Zernio, `SUPABASE_JWT_SECRET`, `OPENCMO_WEB_URL`, `OPENCMO_LOOK_URL`/`TOKEN`, `NEXT_PUBLIC_OPENCMO_UI`, `OPENCMO_CMO_PAUSED`.
  - Engine `pytest` for `deploy_env`.
- [x] **S3.3 Price fal and ElevenLabs spend.**
  - Migration: `provider_prices` rows for fal and ElevenLabs, per unit the code records (`record_provider_usage` units in `generate_task.py`).
  - pgTAP test; `current.sql` regenerated.
- [x] **S3.4 ScrapeCreators shapes from real responses.**
  - Write a one-off script `apps/web/scripts/scrapecreators-fixtures.mts`. The owner runs it with the real key; no key goes in the repo.
  - It calls each endpoint in `lib/cmo/social/research.ts` once (about 16 calls, a few cents), strips personal fields, and saves the bodies as fixtures.
  - Write parser checks on those fixtures, and fix any parser they break.
  - Until the owner runs it, the checks run on the shapes in the ScrapeCreators docs. Say so in the PR.
- [x] **S3.5 A price card before every Sales scan** (`cmoScope.plan()` around `scope.ts:637`, `cmo-tools.ts:369-375`).
  - `create_task{agent:"sales"}` returns an approval card with the scan's price (`JOB_PRICES.sales_scan`, `lib/cmo/jobs/progress.ts:30`) and what it will search.
  - Nothing runs or is held before Approve. The same applies to the other priced `create_task` agents: `competitor_research`, `niche_video_research`.
  - The weekly `reddit-listening` loop keeps its existing budget gate.
  - Check: a CMO chat check where a scan asked in chat stops at a card.
- [x] **S3.6 Sales screen buttons** (`components/screens/sales/SalesScreen.tsx`).
  - "Scan now" goes through the same card as S3.5.
  - "Add N credits and finish" (line 105) raises that run's budget through the job's existing budget path (`lib/cmo/jobs/start.ts`, a migration if needed). If no clean path exists, remove the button. No disabled "arrives with…" button stays.
- [x] **S3.7 Billing fixes from the 2026-11-06 review** (one migration):
  - Usage past an Assistant turn's hold is labelled "Assistant usage", not "Assistant refund" (`agent_close_turn`).
  - Studio usage covered by the order's hold reaches `work_order_spend` when the order ends (`studio_order_release_hold`).
  - `credit_order_draw` moves money with one ledger row instead of two, so one `/video` no longer pushes "Plan payment" off the 30-row history. If that changes the money primitives, write a note and ask the owner first.
  - If S2 asks for "keep the plan until the period ends" on a Creem cancel, it goes in this migration too.

## Checks

- pgTAP on a reset database (`npm run db:reset && npm run db:test`)
- `npm run typecheck`
- `cd apps/web && npm run check:contracts`
- engine `pytest -q` and `ruff check .`
- After deploy: the Costs page on production shows a green row for every provider.

## Owner checklist (put it in the PR; it cannot be done from here)

- `ANTHROPIC_API_KEY` must be valid and identical on Vercel, `opencmo` and `opencmo-mcp`. The 401 of 2026-11-08 came from Vercel.
- Set the other keys:
  - `FAL_KEY` on Vercel, `fal-secret` and `opencmo-mcp`;
  - `ELEVENLABS_API_KEY` on Vercel and `opencmo-voice`;
  - `OPENCMO_ENV=production` on the worker.
- The Creem live key and `CREEM_WEBHOOK_SECRET` on Vercel, and the key on `opencmo`. Then request the Creem review.
- Remove the retired keys: `GEMINI_*`, `GROQ_*`, `OPENAI_COMPAT_*`, `CMO_LLM_PROVIDER(S)`, `POLAR_*`.
- Decide on Vercel Pro (Hobby has a 300 s request limit and its terms for commercial use apply).
- Answer R0 before the new Sales lead types.

## Requests

_(other sessions write here)_
