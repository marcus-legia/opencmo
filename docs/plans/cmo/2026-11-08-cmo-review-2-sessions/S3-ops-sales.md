# Session S3: providers you can see, and Sales that charges first

Plan: [`../2026-11-08-cmo-review-2-plan.md`](../2026-11-08-cmo-review-2-plan.md) · rules: [`README.md`](README.md).

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

- [ ] **S3.1 Costs page: one live row per provider** (`lib/ops/switches.ts`, `app/app/settings/costs`).
  - Rows: Anthropic, fal, ElevenLabs, motion, Creem, ScrapeCreators, next to the existing ones.
  - Each row runs a cheap live check, server side, cached for a few minutes, and never prints a key:
    - Anthropic: `GET /v1/models`;
    - ScrapeCreators: `/v1/credit/balance`;
    - Creem: moderation of a fixed safe prompt;
    - fal and ElevenLabs: the cheapest authenticated read their APIs offer. Find it first.
  - Each row shows one of "not set", "invalid key", "test key in production" or "ok". Reuse `lib/llm-health.ts`.
  - Check: a key set to `x` shows "invalid key".
- [ ] **S3.2 Deploy check and `.env.example`.**
  - `deploy_env.py` / `check_deploy_env.py`:
    - check that the Creem key mode is the same on Vercel and the `opencmo` worker;
    - list ScrapeCreators, Zernio (`ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, `OPENCMO_PUBLISH_LIVE`), Resend and VAPID.
  - Add to both `.env.example` files: Zernio, `SUPABASE_JWT_SECRET`, `OPENCMO_WEB_URL`, `OPENCMO_LOOK_URL`/`TOKEN`, `NEXT_PUBLIC_OPENCMO_UI`, `OPENCMO_CMO_PAUSED`.
  - Engine `pytest` for `deploy_env`.
- [ ] **S3.3 Price fal and ElevenLabs spend.**
  - Migration: `provider_prices` rows for fal and ElevenLabs, per unit the code records (`record_provider_usage` units in `generate_task.py`).
  - pgTAP test; `current.sql` regenerated.
- [ ] **S3.4 ScrapeCreators shapes from real responses.**
  - Write a one-off script `apps/web/scripts/scrapecreators-fixtures.mts`. The owner runs it with the real key; no key goes in the repo.
  - It calls each endpoint in `lib/cmo/social/research.ts` once (about 16 calls, a few cents), strips personal fields, and saves the bodies as fixtures.
  - Write parser checks on those fixtures, and fix any parser they break.
  - Until the owner runs it, the checks run on the shapes in the ScrapeCreators docs. Say so in the PR.
- [ ] **S3.5 A price card before every Sales scan** (`cmoScope.plan()` around `scope.ts:637`, `cmo-tools.ts:369-375`).
  - `create_task{agent:"sales"}` returns an approval card with the scan's price (`JOB_PRICES.sales_scan`, `lib/cmo/jobs/progress.ts:30`) and what it will search.
  - Nothing runs or is held before Approve. The same applies to the other priced `create_task` agents: `competitor_research`, `niche_video_research`.
  - The weekly `reddit-listening` loop keeps its existing budget gate.
  - Check: a CMO chat check where a scan asked in chat stops at a card.
- [ ] **S3.6 Sales screen buttons** (`components/screens/sales/SalesScreen.tsx`).
  - "Scan now" goes through the same card as S3.5.
  - "Add N credits and finish" (line 105) raises that run's budget through the job's existing budget path (`lib/cmo/jobs/start.ts`, a migration if needed). If no clean path exists, remove the button. No disabled "arrives with…" button stays.
- [ ] **S3.7 Billing fixes from the 2026-11-06 review** (one migration):
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

- **From S2 (S2.5), not urgent:** a week-plan item for a video the founder records themselves. Today every
  non-slideshow `video` item of a plan run becomes `write_video_brief` + `build_video` in `work_orders_plan_week`, so S2.5
  drops them all in `toPlanItems` (no AI video). To keep "video scripts and storyboards in the Writer's output when the
  strategy calls for a video the founder records", the plan needs an item that orders only the brief. Proposal: a
  `video` item with platform `Script` creates `write_video_brief` and no `build_video`, with a pgTAP test. Once it is in,
  S2 (or whoever owns `plan-week.ts` then) lets `toPlanItems` keep one `Script` item a week. Owner's call whether this
  waits for the next plan.
- **From S2 (S2.6), done by S2:** the owner let S2 write this one migration (`20270111200000_post_myself.sql`, RPC
  `cmo_post_myself`, pgTAP `270_post_myself`; `current.sql` regenerated). Nothing for S3 to do; S3's own migrations
  can stay below or above that timestamp. Also seen by S2: `249_cmo_review_plan_card` test 4 fails on a Sunday run. The request was: "I posted it" on a post draft when no account is connected. Today approving a post with no
  connected account still makes a schedule slot in `intent` mode and raises its card (`schedule_propose`), which then
  reminds or fails as `no_account` at the slot's time, and `cmo_mark_posted` needs the item `approved` and leaves that
  slot and card open. Needed: one RPC (or `cmo_mark_posted` with a flag) that approves the draft, marks it published,
  and cancels its proposed slots and their approvals in the same transaction, with a pgTAP test. S2 then adds "Copy
  and open" and "I posted it" to the draft card (`components/cards/ApprovalCard.tsx`) when the platform has no
  connected account.
