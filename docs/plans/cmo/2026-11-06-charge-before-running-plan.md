# Plan: charge before running, then run in one go (T9)

Date: 2026-11-06. Approved by the owner 2026-11-06. Task T9 of
[`2026-11-05-agent-team-models-moderation-spec.md`](2026-11-05-agent-team-models-moderation-spec.md) (decision D9,
section 6). Code is built in phases on its own branch, each phase its own PR.

## Context

Owner decision D9 (2026-11-05, spec §6, CLAUDE.md "Charge before running"): a paid job shows its storyboard and ONE
credit estimate for everything it will spend; the user confirms once; the credits are held; the job runs to the end
with no second approval; no paid step runs before the confirmation; only failed or blocked work comes back.

Today money leaks in five places (found in code, file:line from the exploration):

| Leak | Where | Cause |
|---|---|---|
| `/video` stops twice | `lib/agent/create-video.ts:410-444` (card 1 = keyframes only), `lib/agent/long-take.ts:127-252` (card 2 = shots, voice, music) | Keyframes and director/Assistant tokens are spent before the user decides to make the video |
| One hold per generation, no job hold | `create_generation` holds `ai_price` per row (`current.sql:5947`); nothing holds once for a job | A job can start half-paid; no single estimate exists |
| Assistant usage above the hold is free | `agent_close_turn` charges `least(hold, used)` (`current.sql:385`), same cap in `agent_record_usage_for` (`:1030`) | Long steps and sub-agents (director, motion) run past the hold unbilled |
| Explainer previews before the price card | `preview_explainer` is "free" (`explainer-tool.ts:341`); the price card only comes after code + previews (`:469-534`) | Code-writing tokens and Modal renders run before the user agrees to anything |
| Studio model calls go free | `studio_record_usage` charges pay-as-you-go, clamped to the balance (`current.sql:12565`); no `work_order` hold exists; the daily spend cap never sees Studio (`record.ts:17,42`) | Founder at 0 balance still gets director/clip-editor tokens (C1) |

Intended outcome: every paid job = **plan (cheap) → one card with one estimate → one hold → run to the end → settle**.

## Design

### 1. One hold per job: `credit_orders` (SQL, the building block everything else uses)

New table `credit_orders` (id, user_id, kind `long_take|explainer|studio_video`, estimate_credits, status
`held|settled`, source ref: `agent_turn` id or `work_order` id, created_at, settled_at) and ledger ref_kind
`credit_order`. Reuses the existing primitives `credit_hold` / `credit_settle` / `credit_held`
(`20261101090000_r6_credit_module.sql`), no new money path (web rule 5).

- `credit_order_open(kind, estimate, source_kind, source_id, request_id)` → holds the whole estimate once
  (`credit_hold('credit_order', id, estimate, …)`); idempotent on `request_id`; refuses below balance.
- `create_generation(…, p_order_id uuid default null)`: with an order, it skips its own `credit_hold` and checks the
  order's remaining estimate instead (sum of reserved generations + recorded tokens ≤ estimate). Without an order it
  behaves as today (single generations from the Generate panel keep their per-generation hold).
- `complete_generation` / the `sync_generation_from_task` trigger: an order generation records `credits_final`
  (or 0 when failed/cancelled/blocked) and moves no money itself.
- Tokens: `agent_record_usage_for` and `studio_record_usage` add to the order when the turn/work order has an open one.
- `credit_order_settle(order)`: charges sum(credits_final) + token credits, capped at the estimate, refunds the rest;
  called when the last generation of the order is terminal (trigger) and by a reaper for orders older than 24 h.
- pgTAP: open/hold once, idempotent, generation under order holds nothing extra, failure refunds its share, settle
  refunds the rest, cap at estimate, reaper, grants (service role vs authenticated, as `181`/`182`).

### 2. Keyframe → shot chaining (so `/video` runs without stopping)

`after` exists but means "start from the previous shot's last frame" and excludes `startImage`
(`current.sql:1205,1250`). Add `startAfter` / `endAfter` (spec hash of a keyframe generation in the same job): the
shot waits for that keyframe, the worker resolves the keyframe's output path into `startImage`/`endImage`, and a
failed keyframe fails (refunds) the shots that depend on it, through the same chain trigger as `after`
(`sync_generation_from_task`, `current.sql:13074-13130`). Twins: `ai_check_spec` (SQL), `normalizeSpec`/zod
(`packages/editor-core/src/generate.ts`), worker spec parsing (`packages/engine/opencmo/worker/generate_task.py`).
Tests: pgTAP like `148_chained_shots`, `long-take.check.ts`, a worker test.

### 3. `/video` in one go (editor and MCP)

- `create_video` becomes the only priced tool of a long take: the director plans (tokens on the turn's normal hold,
  as today), then ONE card: storyboard (existing `StoryboardTable`) + one total = keyframes + shots + voice + music
  (prices already computed by `videoCredits`, `create-video.ts:389-405`, made exact with fixed seeds).
- On approve: `credit_order_open`, then keyframes, shots (`startAfter`/`endAfter`), voice and music are created under
  the order in one `runGeneration` (`generate-tool.ts:384-491`, keeps its cancel-all on partial failure), and the
  `create_video` op that places them is applied at once (the op already declares pending pieces).
- `animate_video` is removed as a separate step; the contact sheet (`ContactSheet.tsx`) becomes a view on the placed
  scene with per-keyframe Redo, which is the existing `redo_keyframe` (its own card and price, unchanged).
- Moderation: Creem screens every piece before the card (`screenPieces`), so a blocked prompt costs nothing.
- Update texts that describe two cards: `guides.ts` video guide, `prompt.ts`, `slash.ts`, tool descriptions,
  `limits.ts SLOW_PLANS`, MCP `packages/mcp-server/src/groups/studio.ts` (create_video confirm runs everything).
- Checks: `video-usecases.check.ts`, `long-take.check.ts`, `client-plans.check.ts`, `server.check.ts`, eval tasks.

### 4. Studio `build_video` with one card

- Card 1 (`steps.ts stepCard`, kind `script`) carries the full estimate: media total (as in §3) + a director/video-team
  token allowance (constant, e.g. 3 credits).
- On approve: `credit_order_open(source=work_order)`, then the same one-go creation as §3; `nextStep`
  (`adapter.ts:184-197`) goes straight to `render` waiting on all pieces. Card 2 (contact sheet) is removed;
  card 3 (`finished_video`) stays: it approves the result for publishing (product rule "Assist, never act"), not a
  payment.
- `studio_record_usage` charges against the order (no more clamp-to-balance free tokens: C1 closed); planning tokens
  before card 1 are held by a small `work_order` hold taken when the order is claimed (`runOrder`, `studio-orders.ts:100`).
- Studio runs inside `withSpend({refKind:"work_order"})` so the daily spend cap sees it (`record.ts`).
- Tests: `208`, `209`, `206` pgTAP updated; `studio.check.ts`; `p2-acceptance.e2e.ts`.

### 5. Explainer: confirm before code

- New first step in the flow (`/explain`): the Assistant writes the storyboard (say / label / visual per beat) and the
  direction; `plan_explainer` (priced, `approval: true`) shows it with one estimate = `priceOf` explainer render
  (seconds from the narration, voice) + a fixed allowance for writing the code and previews (`AGENT_3D_HOLD_CREDITS`,
  20, today's preview hold).
- On approve: `credit_order_open(kind=explainer, source=turn)`; the turn's preview and code tokens record against the
  order; `add_explainer` no longer shows a second card: it creates the render generation under the order. A storyboard
  change after approval means a new `plan_explainer` card.
- `preview_explainer` is refused until a `plan_explainer` order is open in the turn (editor) or a confirm was used
  (MCP), so no preview runs before confirmation.
- Tests: `explainer-tool.check.ts`, pgTAP `154`, MCP `server.check.ts`.

### 6. Assistant turns: usage above the hold is billed

- `agent_close_turn` and `agent_record_usage_for` charge actual usage up to the balance instead of `least(hold, used)`
  (keep the hold as the pre-step gate, keep auto-extend to 60). pgTAP `095` and `193` flip their "capped at hold"
  asserts. Small, independent: can ship first.

## Phases (each a PR, green on its own)

1. **§6** turn overage billed (S) — no dependency, closes the simplest leak.
2. **§1** `credit_orders` + `create_generation(p_order_id)` + settle (M) — the building block; nothing uses it yet.
3. **§2** keyframe → shot chaining (M).
4. **§3** `/video` in one go, editor + MCP (L).
5. **§4** Studio one card (M).
6. **§5** Explainer confirm before code (M).

Each phase follows the `supabase-migrations` skill (new migration, pgTAP, `scripts/dump-schema.sh`), the
`security-review-checklist` skill (credits, grants), and keeps the Generate panel's single generations unchanged.

## Verification

- `npm run db:reset && npm run db:test` (pgTAP for every SQL change), `npm run typecheck`,
  `cd apps/web && npm run check:contracts`, engine `pytest -q` and `ruff check .` for §2.
- End to end on the dev stack with the fake models (`OPENCMO_AI_FAKE=1`): `/video` shows one card, one ledger hold
  row `credit_order`, keyframes and shots run without a second card, the ledger ends with one settle and the right
  refund; a forced failing shot (`[[flag-output]]`) refunds only its share; Studio order from `p2-acceptance.e2e.ts`
  raises one card then `finished_video`; an explainer refuses `preview_explainer` before `plan_explainer`.
- MCP: `create_video` price → confirm → all pieces created, read back with `get_project_state` and `get_generation`.
- Look at a frame of the finished long take (CLAUDE.md "Verify by looking").

## Out of scope

Single generations from the Generate panel, voice-overs and background replace keep their per-generation hold (they are
already one card, one hold). Output blocked after fal was paid stays our cost (prompts are screened by Creem first).
