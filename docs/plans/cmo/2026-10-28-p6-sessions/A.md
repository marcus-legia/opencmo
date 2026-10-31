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
      hour in the founder's timezone); `schedule_propose` (`20261230100000_p4_slots.sql`) prefers them over
      `schedule-defaults.json`'s slots; the existing jitter, gaps and caps stay; the card's one-line reason. pgTAP.
- [ ] **A4 Card budget**: about 10 cards a day; past it the brain batches (one card per batch) or waits; the Brain
      measures loader (`brain.md` §10).
- [ ] **A3 Reply outcomes (R3)**: 3 days after "replied", re-read the thread (by the pasted URL, else a match on the
      founder's text), store votes and replies, write a memory note; outside text as data.
- [ ] **A5 Acceptance** with fakes (F13), screenshots of Analytics, the phone queue and the digest email into
      `docs/plans/cmo/2026-10-28-p6-acceptance/`.

## Requests

(Others append `[from → A] what, why`; answer here with the commit.)

- [ ] **[from B → A] 1. Look check before a Studio card (S4, M2; owner confirmed "only before a card", 2026-10-31).**
      Contract: `apps/web/lib/departments/studio/look-check.ts` (`LookCheckInputSchema`, `LookResultSchema`,
      `lookNextStep`) and the worker side `packages/engine/opencmo/worker/look_check_task.py` (B builds the task in B1).
      Asked of A, in one `20270101*` migration with pgTAP:
      - a task kind `look_check` (the SQL kind check; B adds the row to `packages/contracts/task-kinds.json` in the same
        push window so `task-kinds.check.ts` stays green; tell B the commit);
      - where a Studio render is done today and a card is raised (`tasks_studio_rules` for `editor_project`,
        `short_batch_settle` for `short_batch`, `studio_slideshow_settle` for `studio_step`): enqueue one `look_check`
        task with `settings = {ref_kind, ref_id, round, files: [{path, clip_id}]}` (the full-size `exports` paths) instead
        of `approval_raise`;
      - on `look_check` done: `pass`, or `round = 1` → `approval_raise` with `look` (the task output) in
        `approval_snapshot`, so `contentHash` changes with it; failed at round 0 → no card, a send-back row the TS side
        can claim (e.g. `studio_look_sendbacks_claim(p_limit)` returning `{ref_kind, ref_id, user_id, order_id, look}`),
        after which B's redo renders again and the next `look_check` gets `round = 1`;
      - `look_check` failed as a task (worker error) → raise the card without a note, never block it;
      - `lookNote` (≤ 200) on the three studio bodies in `approval-card.ts` (your block), read from `snapshot.look.note`.
      Why: cards are raised in SQL, so the wait between "render done" and the card has to live there.
- [ ] **[from B → A] 2. Hacker News threads in Sales (R4).** `cmo_opportunities` (`20261015090000_cmo_sales.sql`) only
      takes `platform = 'reddit'` and a reddit.com URL. Asked: allow `platform in ('reddit','hn')` and
      `^https://news\.ycombinator\.com/item\?id=[0-9]+$` for `hn`; `cmo_save_opportunities` takes each item's
      `platform` (default `reddit`); the `opportunity` snapshot emits `platform`. pgTAP: an hn row saves, an hn URL on a
      reddit row and a reddit URL on an hn row are refused. B sends `platform: "hn"` from `sales-scan.ts` once it lands.
- [ ] **[from B → A] 3. X threads (W4).** Asked: `cmo_save_draft` keeps `body.thread` (array of 5–8 strings, each ≤ 280
      code points; `body.text` = the first post), `approval_snapshot` for a post emits `thread`; the thread block of
      `approval-card.ts` (`PostBody.platforms[].thread?: string[]`); the deliverable built for publishing carries
      `thread` (B adds `thread` to `PublishDeliverableSchema` in `publish/types.ts` unless you prefer to, say so).
      Types: `ThreadDraftSchema`, `ThreadBody` in `lib/cmo/writer/types.ts`.
- [ ] **[from B → A] 4. `check:contracts` additions (your block):** `tsx lib/cmo/social/hn.check.ts` (B3, pushed later;
      B will say when it exists). Studio look-check checks live in `studio.check.ts`, already in the chain.
