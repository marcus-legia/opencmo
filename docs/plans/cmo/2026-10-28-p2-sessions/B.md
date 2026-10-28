# Session B: Studio adapter, video brief, short render, Shorts squad

Plan: [`../2026-10-28-p2-studio-brain-plan.md`](../2026-10-28-p2-studio-brain-plan.md) · rules: [`README.md`](README.md).

## You own

- `apps/web/lib/departments/studio/` (new)
- `packages/mcp-server/src/groups/studio.ts` (becomes a thin caller of the adapter)
- `apps/web/lib/agent/create-video.ts`, `long-take.ts`, `scope.ts` (only what the adapter needs; behaviour unchanged)
- `packages/editor-core/src/ops/` new `shorts.ts` (`make_short`) and its tests
- `apps/web/lib/cmo/agents/registry.ts` (the new `shorts` agent only)
- `packages/clip-export/` and the worker's `render_document` path, only if F7 needs a change
- `apps/web/app/api/v1/studio/` (new): `POST …/[clipId]/finished` and `POST …/[clipId]/shorts`, thin routes over the
  adapter for C's buttons

## Order

B0 → (push, M1) → B1 → B5 (after A3's RPC) → B3 → B2 (after A1) → B4.

## Todo

- [x] **B0 Adapter interface (push first)**: `lib/departments/studio/types.ts` with `plan(clipId, tool, input)`,
      `decide(stepId, action)`, `buildVideo(brief)`, `cutShorts(clipId)`, `markFinished(clipId, hash)`,
      `renderShort(shortClipId)`, their input and output types (the video brief: objective, angle, hooks, key points,
      seconds, aspect, voice), and who may call each (brain, Assistant, MCP, UI). No implementation yet.
- [x] **B1 Extract**: move what MCP's studio group does (clip scope, `scope.plan`, the signed step, `scope.decide`)
      into the adapter; MCP calls it. Every existing MCP check passes unchanged (`packages/mcp-server/src/*.check.ts`
      and `apps/web/lib/mcp/*.check.ts`); same tools, same signed steps, same results.
- [x] **B3 Short render**: `renderShort` queues `render_document` for a short's own edit from a brain order, with no
      editor open and no founder session (service path under the owner's id, as the worker does today); one test
      against `clip-export`.
- [ ] **B2 Video brief**: `buildVideo(brief)` maps the brief to `create_video` input (prompt from objective + angle +
      hooks, seconds, aspect, voice) with the Brand Kit and the strategy voice; each priced step of the long-take
      squad (keyframes, shots, redo keyframe) goes through A's `studio_step_raise` instead of a chat card.
- [ ] **B5 Studio routes**: `POST /api/v1/studio/[clipId]/finished` (body: the document hash the founder sees) and
      `POST /api/v1/studio/[clipId]/shorts` (starts a `cut_shorts` order; refused unless finished), zod-validated,
      rate-limited, English errors.
- [ ] **B4 Shorts squad**: Clip editor (registry agent `shorts`: picks 3 ranges from beats and word timings, hook
      first, 15–60 s), Clip reviewer (code: whole sentences, no overlap, hook in the first 3 s, length per platform;
      sends back once), Builder (`make_short` op in editor-core: copies the parent's range into a new `short` edit,
      9:16 frame, keeps captions), Renderer (B3). AI long videos use their beats; the founder's own finished edits use
      the transcript. Tests for the reviewer and `make_short`; one fake-provider run end to end.

## Requests

(Others append `[from → B] what, why`; answer here with the commit.)

- [from C → B] **B5 response shapes for C2's buttons.** C will call `POST /api/v1/studio/[clipId]/finished` with
  `{ documentHash }` and `POST /api/v1/studio/[clipId]/shorts` with `{}`. Please answer here with: the success body
  (C expects `MarkedFinished` / `{ orderId }`), the status for `stale` and `refused` (C expects 409 with the English
  sentence in `error`, which the button shows as is), and **which hash** the editor's top bar must send: the function
  that hashes the document the same way `mark_finished` / `save_editor_document` compare it, exported from a path the
  browser can import (C must not compute it a second way).
  - [B] Answered (routes in `claude/session-b-cmo-p2-f92e3r`, see Notes). `POST …/finished` with `{ documentHash }`
    → 200 `{ finishedAt, documentHash }`; stale → **409 `{ detail: "<sentence>" }`** (every v1 route's error body is
    `{ detail }`, not `error`: `lib/api/handler.ts` `errorResponse`); a malformed hash → 422. `POST …/shorts` with `{}`
    → **202 `{ orderId }`**; not finished at the current document → 409 `{ detail }`. **The hash:** the browser never
    computes one. SQL hashes the saved document (`editor_document_hash`) and every save hands it back; the top bar
    sends `EditorSession`'s `documentHash` (`lib/editor/session.ts`: the last save's hash, `null` while there are
    unsaved changes, so disable the button or save first), and the Studio grid sends A5's `StudioItem.documentHash`.
- [from A → B] **A1 is in (`20261228100000`): how B2 raises and finishes steps.** Call
  `studio_step_raise(p_clip_id, p_tool, p_kind, p_input, p_card, p_price_credits, p_order_id?, p_redo_of?)` (your
  names; A renamed its `p_price`) under the founder's session. `p_input` = `PreparedStep.input` (what `decide` runs); `p_card` is what the card shows, and the
  snapshot reads only: script → `title`, `seconds`, `aspect`, `beats[] {words, picture, motion}`; price → `title`,
  `what`, `seconds` (**required**, > 0; the video's length even for a redone keyframe: `stepCard` sends null for
  `redo_keyframe` today, which `studio_step_raise` refuses), `wait_minutes`,
  `keyframes[] {index, words, path (media bucket), garbled, credits}`, `shots`. Script cards only for `create_video` /
  `plan_video`. The approvals route runs `decide` and then `studio_step_finish(running | done | failed, error,
  generation_id)`; the adapter's `storedStep` already accepts `approved`.
- [from A → B] **Edit a beat needs a re-plan entry.** `edit {beat, text}` on a script card cancels the step
  (`decision = 'edit'`, `decision_payload = {beat, text}`) and the card closes as `edited`; nothing re-plans yet. Please
  add an adapter call (e.g. `replan(stepId)`: read the cancelled step's input + payload, swap that beat's words, plan
  `create_video` again, raise a new step with `p_order_id` from the old one) and tell A where to call it; A will call it
  from the approvals route right after `approval_decide` returns an `edit`. Same for redo: when the redone keyframe's
  generation is done, the new contact sheet is a new `price` step with `p_redo_of` = the old step (A2's order runner
  will call your hook).
- [from A → B] **F7 bug found in A6: a brain-made long video never renders.** On the real local stack (fake
  providers), card 2 approved → shots, voice, music done → `render_document` fails with "A generated file is not in
  this project's library". No editor tab is open, so the worker falls back to `_finished_generation`, and
  `_generation_row_matches` (`packages/engine/opencmo/worker/render_document_task.py`) compares `startFrame` /
  `endFrame` field by field: the document's shot declares its keyframes as nested `generate` declarations, while the
  `generations` row stores the resolved `startImage` / `endImage` paths and no `startFrame`. Every long-take shot
  misses; the voice and music match. A patch that made A6 pass locally (not pushed, your path):
  skip a frame field when the declaration's value is a dict and the row has the resolved key
  (`_RESOLVED_FRAMES = {"startFrame": "startImage", "endFrame": "endImage"}`); `test_worker_render_document_task.py`
  still passes (28). Please add it with a regression test (a shot with nested frame declarations, no library record).
- [from A → B] **Second A6 gap: a brain-made video has no voice-over words.** After card 3 the squad refuses: "no
  stretch of 15–60 seconds of whole sentences". `spokenWords` returns 0 words on the finished edit (6 beats found):
  its `Voiceover captions` node has no `src` (`{"kind":"captions","marks":{"voiceover":{"key":…}}}`), because the
  editor fills it when the voice generation finishes, and a brain order never opens an editor. The rendered video has
  no captions for the same reason (frame in `2026-10-28-p2-acceptance/render-frame-12s.png`). Needed: finish the long
  take's pending pieces server side once its generations are done (voice-over captions `src`, the library records
  the editor would add), as part of `decide` for `animate_video` or a `finishVideo(clipId)` the runner calls before
  the render. Say which and A2's runner calls it (`studio-orders.ts` `runNext`, `next.tool === "render"`).
  - [B] Answered A's four A1/A6 requests (`be8949f`, `7464580`):
    1. **Redo price card:** `stepCard` now shows the one keyframe being redone (`path: null`) and `raiseStep` takes
       `seconds` from the step in `p_redo_of` (its card), so `studio_step_raise` gets a length > 0.
    2. **Edit a beat:** `adapter.plan(clipId, "create_video", null, { store: true, editOf: stepId })` from a
       brain-caller adapter (`caller: "brain"`; `store` is brain only). It reads the cancelled step's
       `input.longTake` and `decision_payload {beat, text}`, swaps that beat's words, rebuilds the script from the
       beats, and plans `create_video` again as a finished plan (the code Reviewer checks it, no Director, no agent
       credits), raising the new step under the old step's `order_id`. Call it right after `approval_decide` returns
       an `edit`. Redo needs nothing from B: your runner's `withKeyframe(step.plan_input, …)` + `plan(…, { store,
       redoOf })` is the one path (B dropped its duplicate).
    3. **F7, long take never renders:** fixed in the worker (`render_document_task.py`), stricter than the patch in
       the request: a nested keyframe declaration resolves to its own finished generation in this project, and the
       shot row matches only if that is the exact `startImage` / `endImage` it was made from (skipping the field
       would accept a shot made from another keyframe with the same prompt and seed). Two regression tests; the
       first fails without the fix. Engine suite: 671 pass, 1 fails the same without the change
       (`test_ai_motion_provider.py::test_a_clip_mp4_has_no_audio_stream`).
    4. **No voice-over words:** `finishVideo(ctx, clipId)` in `lib/departments/studio/finish.ts` runs
       `sync_voiceover` for every voice that is done (length + word timings from its `media_assets` row), as the
       editor's `useVoiceovers` does, through `applyToClip` with no checkpoint. Returns `{ attached, waiting }`. Call
       it in `runNext` right before `renderVideo` (`next.tool === "render"`); if `waiting > 0`, wait and retry rather
       than render. It changes the document, so never call it on a finished edit (it would clear the mark); B does not
       call it from `cutShorts` for that reason.

## Notes

- **Shipped on `cmo-p2`:** B0 `01eab55`, B1 `93a0b2e`, B4 squad + `make_short` `21680c8`, B3 + `spokenWords` /
  `shotBeats` `f1f3956`, B2 + B4 orchestration `451fc7e`. Checks: `apps/web` typecheck, `check:contracts` (with A4's
  guard), editor-core vitest (37 files), clip-export vitest with real ffmpeg (`short.test.ts`), MCP `npm test` and its
  tsc, `lib/departments/studio/studio.check.ts` and `shorts/squad.check.ts`.
- **B5 routes** (`app/api/v1/studio/[clipId]/{finished,shorts}/route.ts`) are one commit on
  `claude/session-b-cmo-p2-f92e3r` on top of `cmo-p2`: A4's caller-path guard fails until A lists them (request in
  `A.md`). Cherry-pick onto `cmo-p2` once A pushes the two `CALLER_PATHS` lines.
- **Adapter shape after A4:** still the six B0 entries. `plan(…, { store: true })` (brain only) stores the step and
  raises its card; `cutShorts` from the UI only orders a `cut_shorts` order, from the brain it cuts.
- **Open, waiting on A:** B2 and B4 run live only once `studio_step_raise`, `mark_finished`, `cut_shorts_order` and
  `short_batch_create` exist (signatures requested in `A.md`) and A2's runner calls the adapter. Not ticked until then.
- **Measured in the cloud session (2026-10-28):** three shorts cut by `make_short` from a 60 s 1920×1080 edit with
  captions, rendered by `clip-export run` at 1080p (`parallel: 2`): each job peaks at **~1.6 GB** RSS for the whole
  process tree (node + ffmpeg, sampled from `/proc` every 50 ms; `/usr/bin/time` is not installed), under the 2 GB
  budget; all three at once 4.8 GB, 48 s wall, so the worker must keep them in separate jobs (its parallel cap), never
  one job. Looked at frames of the full-size `short1.mp4`: 1080×1920, 20.1 s, captions centred inside the frame,
  sound at −21 dB mean.
- **Still local only:** Docker starts in the cloud container, but `supabase start` cannot pull
  `supabase/postgres:17.6.1.167` (the proxy blocks GHCR and ECR blob hosts; Docker Hub answers 429). So on a machine
  with the stack: one fake-provider run of the Shorts squad end to end (finished edit → batch → three short edits →
  three `render_document` tasks), B5's routes against the real RPCs, and `db:reset && db:test`; all of it also needs
  A's four RPCs first.
