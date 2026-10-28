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
- **Local only (needs Docker + the local Supabase stack, not in this cloud container):** one fake-provider run of the
  Shorts squad end to end (B4's last item: finished edit → batch → three short edits → three `render_document` tasks),
  B5's routes against the real RPCs, peak RSS of three short renders with `/usr/bin/time -v`, and looking at a frame
  of a rendered short's full-size file (CLAUDE.md "Verify by looking").
