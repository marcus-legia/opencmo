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

- [ ] **B0 Adapter interface (push first)**: `lib/departments/studio/types.ts` with `plan(clipId, tool, input)`,
      `decide(stepId, action)`, `buildVideo(brief)`, `cutShorts(clipId)`, `markFinished(clipId, hash)`,
      `renderShort(shortClipId)`, their input and output types (the video brief: objective, angle, hooks, key points,
      seconds, aspect, voice), and who may call each (brain, Assistant, MCP, UI). No implementation yet.
- [ ] **B1 Extract**: move what MCP's studio group does (clip scope, `scope.plan`, the signed step, `scope.decide`)
      into the adapter; MCP calls it. Every existing MCP check passes unchanged (`packages/mcp-server/src/*.check.ts`
      and `apps/web/lib/mcp/*.check.ts`); same tools, same signed steps, same results.
- [ ] **B3 Short render**: `renderShort` queues `render_document` for a short's own edit from a brain order, with no
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
