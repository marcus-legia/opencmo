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

- [x] **A0 Contracts (push first)**
  - [x] 1. Migration `*_p2_studio.sql` skeleton with grants, RLS read-own and pgTAP: `studio_steps` (id, user,
        clip_id, tool, input jsonb, price_credits, status `waiting|approved|running|done|cancelled|failed`, order_id,
        created_at, decided_at), `shorts` (id, user, parent_clip_id, short_clip_id, source_start, source_end, hook,
        reason, batch_id, status), `short_batches` (id, user, parent_clip_id, order_id, status), `clips.kind` gains
        `short` (with `parent_clip_id`), `editor_projects.finished_at` + `finished_hash`.
  - [x] 2. `approvals.ref_kind` gains `studio_step`, `editor_project`, `short_batch`; `approval_snapshot` cases for
        them (fields below).
  - [x] 3. `lib/screens/approval-card.ts`: snapshot types for `script` (beats: words, picture, motion), `price`
        (credits, wait, keyframes or shots), `finished_video` (clip id, length, frame, document hash) and
        `shorts_batch` (3 × range, hook, reason, preview); fixtures for each.
  - [x] 4. `packages/contracts/capabilities.json` JSON schema (fields from `brain.md` §7) with today's CMO jobs.
- [x] **A4 Registry**: every Studio entry point and CMO job listed; `check:contracts` fails on a caller path the
      registry does not list (the brain, the Assistant, MCP, the UI).
- [x] **A1 Studio steps**: RPCs `studio_step_raise` (from the adapter's `plan`, holds nothing), `approval_decide`
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
  - [A] Answered in the A0 commit: `price.keyframes` is `{ index, label, thumbUrl | null, garbled, credits }[]` (empty
    when the price is for shots only), `script.beats[].motion` (nullable), `finished_video.documentHash`, and
    `frameAt` (seconds into the render to show as the still: there is no poster image, so C seeks the preview there),
    `shorts_batch.shorts[].reason` and `shortClipId` (plus `batchId`, `parentClipId`). The SQL snapshots keep the
    card's own names (`words`, `path`); the loader maps them.
  - [A] Accepted as named: `redo {index}`, `cancel {reason?}` (script and price), `send_back {reason?}` (finished
    video and shorts batch), `edit {beat, text}` (script). `STUDIO_ACTIONS` in `approval-card.ts` lists them per kind.
    The route schema, `approval_decide` and the decidable set come with A1; a decline on a `needs_credits` card will be
    accepted there.
  - [A] Noted for A5: `clipId`, `documentHash`, `canCutShorts` on `StudioItem`.
- [from B → A] **The SQL B's adapter calls (A1, A3).** Already written against these names in `451fc7e`
  (`lib/departments/studio/`); answer here if you name them differently and B renames.
  1. `studio_step_raise(p_clip_id uuid, p_tool text, p_kind text, p_input jsonb, p_card jsonb, p_price_credits int,
     p_order_id uuid, p_redo_of uuid)` → the `studio_steps` row, card raised in the same transaction, nothing held.
     `p_card` is exactly the fields your A0 notes list (`steps.ts` `stepCard`).
  2. `mark_finished(p_clip_id uuid, p_document_hash text)` → the `editor_projects` row (`finished_at`,
     `finished_hash`); a stale hash raises `P0001` with an English sentence (the route answers 409 with it).
  3. `cut_shorts_order(p_clip_id uuid)` → the new `cut_shorts` order id; `P0001` with a sentence unless the edit is
     finished at its current document. Idempotent per (clip, finished hash) would stop a double click making two.
  4. `short_batch_create(p_parent_clip_id uuid, p_parent_hash text, p_order_id uuid, p_shorts jsonb)` →
     `{ batch_id, shorts: [{ short_id, short_clip_id }] }` in input order, one transaction: refuse unless
     `finished_hash = p_parent_hash =` the current document hash; a `short_batches` row (`rendering`); per item a
     `clips` row (`kind 'short'`, `parent_clip_id`, the parent's `job_id`, `hook` = `title`), its `editor_projects`
     row with `document`, and a `shorts` row (`rendering`). Items: `source_start`, `source_end`, `hook` (≤ 120),
     `title` (≤ 60), `reason` (≤ 300), `document` (object; `make_short`'s output, small).
- [from B → A] **Two routes for `CALLER_PATHS` (A4's guard).** `apps/web/app/api/v1/studio/[clipId]/finished/route.ts`
  and `.../shorts/route.ts`, callers `["ui"]`, reaches `studioEntries` (they call `markFinished` and `cutShorts`). Until
  they are listed the check fails, so B5's routes sit on branch `claude/session-b-cmo-p2-f92e3r` only (one commit on
  top of `cmo-p2`); B cherry-picks them onto `cmo-p2` once you push the two lines.
- [from B → A] **`check:contracts` additions.** `NODE_OPTIONS=--conditions=react-server tsx
  lib/departments/studio/studio.check.ts` and `.../shorts/squad.check.ts` (both pass, no network). `make_short` is
  covered by editor-core's vitest and the short render by `packages/clip-export/src/short.test.ts` (real ffmpeg,
  already in `test:clip-export`).
- [from B → A] **How A2's runner drives Studio.** `studio({ supabase: clientFor(userId), userId, caller: "brain",
  orderId }, { recordUsage })` (`lib/mcp/auth.ts` `clientFor` mints the short-lived user JWT). `build_video`:
  `buildVideo(brief)` → `{ clipId, stepId, credits }` (card 1 waits). `approval_decide` approve on a step →
  `decide({ stepId }, { kind: "approve" })`; for `create_video` the decision carries `next = { tool: "animate_video",
  input, waitFor }`: once every `waitFor` generation is done, `plan(clipId, next.tool, next.input, { store: true })`
  raises card 2. Redo on card 2 → `decide({ stepId }, { kind: "redo", index })`. `cut_shorts` →
  `cutShorts(parentClipId)` → `{ batchId, shorts }`, renders already queued; render tasks then move the batch.
  Note: each short render goes through `request_document_export`, so three shorts count against the founder's daily
  export quota; say if brain renders should be exempt (that is SQL).
  - [A] 1–2 are in A1 (`20261228100000`) with your names (A renamed its `p_price` to `p_price_credits`); 3–4
    (`cut_shorts_order`, `short_batch_create`) come with A3, signatures as you wrote them, `cut_shorts_order`
    idempotent per (clip, finished hash). The two B5 routes are in `CALLER_PATHS` (a listed file that is not on the
    branch yet is skipped), and `studio.check.ts` + `squad.check.ts` are in `check:contracts`: cherry-pick B5 now.
    A2's runner will drive Studio as you describe. Export quota: brain renders count like the founder's for now (three
    shorts per finished video, and the founder approved the video); A3 says so in the batch card's meta if a render is
    refused for the quota. Owner's call if it should change.

## Notes

- A0 (`20261228090000_p2_studio.sql`, `205_p2_studio.test.sql`): `studio_steps.card` is what the adapter's `plan`
  returns for the card; `approval_snapshot` reads only these fields of it. Script: `title`, `seconds`, `aspect`,
  `beats[] {words, picture, motion}`. Price: `title`, `what`, `seconds`, `wait_minutes`, `keyframes[] {index, words,
  path, garbled, credits}`, `shots`. Snapshots hold storage paths, never signed URLs. Shapes in TS:
  `ScriptSnapshotSchema`, `PriceSnapshotSchema`, `FinishedVideoSnapshotSchema`, `ShortsBatchSnapshotSchema`
  (`lib/screens/approval-card.ts`). `studio_steps.redo_of` links a redone keyframe to the step it replaces.
- pgTAP was run in a cloud session against `supabase/postgres:17.6.1.054` without GoTrue or storage-api: 112 files
  pass, the same 4 fail as on `7664261` (`010_rls`, `040_worker_d2_publication`, `055_web_d3_security_completion`,
  `090_exports_bucket`: storage and Realtime pieces that container does not have). CI's run is the one that counts.
- A4: `capabilities.json` lists the 8 CMO jobs, the 6 Studio adapter entries (`studio_plan`, `studio_decide`,
  `build_video`, `cut_shorts`, `mark_finished`, `render_short`, callers equal to `STUDIO_ACCESS`) and the 13 priced
  Studio tools (MCP's `PRICED` + caption tools). `capabilities.check.ts` fails on a file that starts a CMO job or
  calls the Studio adapter without a `CALLER_PATHS` entry, and on a path that reaches a job or entry not listing its
  caller. **B:** a new caller of the adapter (the brain runner for `build_video`/`cut_shorts`, B5's routes for
  `mark_finished`/`cut_shorts`) needs one line in `CALLER_PATHS` in the same commit, or `check:contracts` goes red;
  append a request here if you'd rather A adds it.
- A1 (`20261228100000_p2_studio_steps.sql`, `206_p2_studio_steps.test.sql`): `studio_step_raise` (authenticated,
  owner of the clip, priced tools only, at most 20 waiting), `studio_step_finish` (approved → running | done | failed |
  cancelled; never approves), `mark_finished(clip_id, document_hash)`, a trigger that raises/supersedes/closes the card
  from the step row, `approvals.reason`, and `approval_decide` for script (approve | edit {beat, text} | cancel), price
  (approve | redo {index} | cancel) and finished_video (approve = `mark_finished` at the card's hash | send_back).
  `POST /api/v1/approvals/[id]` accepts the new actions and, after approve or redo of a step, runs it through the
  adapter (`caller: "ui"`) and reports with `studio_step_finish`. Cards build from snapshots (`cards.ts`) and the
  loader signs keyframes, renders and short previews (`studio-sign.ts`). `DECIDABLE_IN_WAVE_1` now includes script,
  price, finished_video. Cancel moves the step's order to `cancelled`; everything else about order states is A2.
