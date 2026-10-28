# Session A (lead): SQL, brain orders, event rules, registry, loaders

Plan: [`../2026-10-28-p2-studio-brain-plan.md`](../2026-10-28-p2-studio-brain-plan.md) · rules: [`README.md`](README.md).

## You own

- `supabase/migrations/*` after `20261227120000`, `supabase/tests/2*` (new), `supabase/schema/current.sql`
- `packages/contracts/capabilities.json` and its check (`apps/web/lib/cmo/capabilities.check.ts`)
- `apps/web/lib/cmo/jobs/` (plan-week, runner dispatch, progress), `apps/web/lib/cmo/schedule.ts`
- `apps/web/lib/screens/` (types, fixtures, loaders, registry), `apps/web/app/api/v1/screens/`,
  `apps/web/app/api/v1/approvals/`
- `docs/plans/cmo/2026-10-27-screen-contracts.md`, `docs/plans/cmo/2026-10-28-p2-acceptance/`

## Order

A0 → (push, M1) → A4 → A1 (after B0) → A3 → A2 (after B2) → A5 → A6. Post "M1/M2/M3 ready for review" on the PR.

## Todo

- [ ] **A0 Contracts (push first)**
  - [ ] 1. Migration `*_p2_studio.sql` skeleton with grants, RLS read-own and pgTAP: `studio_steps` (id, user,
        clip_id, tool, input jsonb, price_credits, status `waiting|approved|running|done|cancelled|failed`, order_id,
        created_at, decided_at), `shorts` (id, user, parent_clip_id, short_clip_id, source_start, source_end, hook,
        reason, batch_id, status), `short_batches` (id, user, parent_clip_id, order_id, status), `clips.kind` gains
        `short` (with `parent_clip_id`), `editor_projects.finished_at` + `finished_hash`.
  - [ ] 2. `approvals.ref_kind` gains `studio_step`, `editor_project`, `short_batch`; `approval_snapshot` cases for
        them (fields below).
  - [ ] 3. `lib/screens/approval-card.ts`: snapshot types for `script` (beats: words, picture, motion), `price`
        (credits, wait, keyframes or shots), `finished_video` (clip id, length, frame, document hash) and
        `shorts_batch` (3 × range, hook, reason, preview); fixtures for each.
  - [ ] 4. `packages/contracts/capabilities.json` JSON schema (fields from `brain.md` §7) with today's CMO jobs.
- [ ] **A4 Registry**: every Studio entry point and CMO job listed; `check:contracts` fails on a caller path the
      registry does not list (the brain, the Assistant, MCP, the UI).
- [ ] **A1 Studio steps**: RPCs `studio_step_raise` (from the adapter's `plan`, holds nothing), `approval_decide`
      cases for `script`/`price` (approve → the adapter's `decide`; `redo` raises a new card, keeps the order waiting;
      cancel releases any hold) and `finished_video` (approve = `mark_finished`; send back keeps it open). pgTAP per
      transition, including a stale hash.
- [ ] **A3 Finished state and event rules**: `mark_finished(clip_id, document_hash)`; `save_editor_document` clears
      it when the hash changes; rules: finished → `cut_shorts` order; batch approved → one `short` deliverable per
      short, status ready for Schedule (P4); render done/failed → order state. pgTAP for each rule.
- [ ] **A2 Video orders**: `plan_week` may plan one video item (strategy + week goal decide; at most one per week
      unless the founder asks); order kinds `build_video` and `cut_shorts`; the runner hands them to B's adapter
      (`buildVideo`, `cutShorts`); order states follow steps, generations and renders; budget from `JOB_PRICES` plus
      the card's price.
- [ ] **A5 Loaders**: Studio items from `studio_steps`, `shorts`, `short_batches` and finished edits (uploads keep
      coming from `/api/v1/projects`); the Dashboard Studio node and log lines; Brain orders with their steps. Flip
      `live` flags; release gating keeps working.
- [ ] **A6 Acceptance** on a local stack with fake providers: plan with a video → card 1 → approve → card 2 →
      approve → render → card 3 → approve (finished) → shorts batch card → approve → three `short` deliverables.
      Peak RSS of the three short renders. Screenshots of the live Dashboard and Studio at 1440 and 390, inside the v2
      shell, into `docs/plans/cmo/2026-10-28-p2-acceptance/`.

## Requests

(Others append `[from → A] what, why`; answer here with the commit.)

- [from C → A] **A0 snapshot fields C0 reads.** The cards are already built on the wave-1 bodies; please add, so C can
  switch over without a new request: `price.keyframes: { index, label, thumbUrl | null }[]` (the redo picker shows
  them; today it falls back to `1..shots`), `script.beats[].motion`, `finished_video.documentHash` and `frame` (the
  approve sends the hash the founder saw), `shorts_batch.shorts[].reason` and `shortClipId`. Why: card 2 is "redo one
  keyframe", and a picker of numbers is all C can show without thumbnails.
- [from C → A] **Decisions the approvals route must accept (A1).** `components/cards/decide.ts` now sends, always with
  `contentHash`: `{ action: "redo", index }` (price, 0-based keyframe), `{ action: "cancel", reason? }` (script and
  price), `{ action: "send_back", reason? }` (finished video and shorts batch), and `{ action: "edit", beat, text }`
  (script: the words of one beat, 0-based, max 300). Please accept these in the `POST /api/v1/approvals/[id]` zod
  schema and `approval_decide`, and add the four Studio kinds to the decidable set (`DECIDABLE_IN_WAVE_1` or its
  successor) when A1 lands. A card with `problem.kind = "needs_credits"` lets the founder cancel or send back (the card
  says "Top up or cancel"); please let `approval_decide` take a decline on such a card. If you prefer other action
  names, answer here and C renames them.
- [from C → A] **A5 Studio item fields for C2/C3.** `StudioItem` needs `clipId` (the edit Mark finished and Cut shorts
  act on), `documentHash` (the hash the founder sees, sent with Mark finished from the Studio grid) and `canCutShorts`
  (finished at the current document). `canMarkFinished` stays as is.
