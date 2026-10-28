# Session A: metrics, best time, reply outcomes, card budget

Plan: [`../2026-10-28-p6-quality-reach-plan.md`](../2026-10-28-p6-quality-reach-plan.md) · rules: [`README.md`](README.md).

## You own

- `supabase/migrations/20270101*`, `supabase/tests/` for them, `supabase/schema/current.sql`
- `apps/web/lib/cmo/jobs/pull-metrics.ts` (Zernio source), new `reply-outcomes.ts`, the brain's batching in `apps/web/lib/cmo/brain.ts`
- `schedule_propose` and `packages/contracts/schedule-defaults.json`
- `apps/web/lib/screens/` (types, fixtures, loaders, registry), `apps/web/app/api/v1/screens/`
- `docs/plans/cmo/2026-10-28-p6-acceptance/`

## Order

A0 → (push, M1) → A1 → A2 → A4 → A3 → A5. Post "M1/M2/M3 ready for review" on the PR.

## Todo

- [ ] **A0 Contracts (push first)**: migration skeleton with grants, RLS and pgTAP: `push_subscriptions`,
      `email_log`, `card_budget` (per user per day), `account_metrics`, `best_slots`, reply outcome columns on
      `cmo_draft_outcomes`; screen types for `analytics.*` and Brain measures; `MetricsSource` interface (public,
      Zernio).
- [ ] **A1 Zernio metrics (P3)**: per post, per account and followers for connected accounts on the `pull_metrics`
      schedule; public reading stays for the rest; loaders `analytics.*` and Dashboard `results`; flip `live`.
- [ ] **A2 Best time (P2)**: `best_slots` from published posts with metrics (≥ 10 per platform, median views per
      hour in the founder's timezone); `schedule_propose` prefers them, defaults otherwise; jitter ±4 min; gaps and caps
      per platform from data; the card's one-line reason. pgTAP.
- [ ] **A4 Card budget**: about 10 cards a day; past it the brain batches (one card per batch) or waits; the Brain
      measures loader (`brain.md` §10).
- [ ] **A3 Reply outcomes (R3)**: 3 days after "replied", re-read the thread (by the pasted URL, else a match on the
      founder's text), store votes and replies, write a memory note; outside text as data.
- [ ] **A5 Acceptance** with fakes (F13), screenshots of Analytics, the phone queue and the digest email into
      `docs/plans/cmo/2026-10-28-p6-acceptance/`.

## Requests

(Others append `[from → A] what, why`; answer here with the commit.)
