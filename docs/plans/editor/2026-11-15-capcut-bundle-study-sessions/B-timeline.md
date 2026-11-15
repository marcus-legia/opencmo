# Session B — timeline (R3 quick wins, R5 move rules, R6 beats, range play, drawing)

Plan: [`../2026-11-15-capcut-bundle-study-plan.md`](../2026-11-15-capcut-bundle-study-plan.md). Runs on a second
Claude account in the cloud. It needs read access to `marcus-legia/opencmo` and `marcus-legia/opencmo-internal`.

Branch: `claude/capcut-research-editor-plan-4fe196`, PR #220. No other branch or PR. Pull (rebase) before every push:
session A pushes to the same branch.

## Start here

1. Clone both repos side by side (`opencmo/` and `opencmo-internal/`).
2. Read `opencmo/CLAUDE.md`, this plan, and `opencmo-internal/docs/specs/2026-11-09-hoc-capcut-timeline.md`.
3. Bundles: `opencmo-internal/research/bundles/capcut/pretty/`. Rules in its `README.md`: CapCut's code has no
   licence; read to learn the behaviour, copy no code, strings, schemas or function names; never run, import or build
   it.
4. No local Supabase or worker is needed: everything here is client-side or pure `editor-core`. Verify with
   `npm run typecheck`, `editor-core` tests and `cd apps/web && npm run build`.

## Files this session owns

- `apps/web/components/editor/timeline/**` (`Timeline.tsx`, `snap.ts`, `rows.ts`, `peaks.ts`, `TimelineTabs.tsx`, new
  files here)
- `apps/web/components/editor/playback.ts`, `apps/web/components/editor/shortcuts.ts`
- `packages/editor-core/src/ops/rows.ts`, `packages/editor-core/src/beats.ts` (+ their tests)
- `packages/editor-core/src/ops/edit.ts`: only the `make_room` block, marked `// capcut-B: make_room`
- `docs/research/editor/2026-11-15-capcut-timeline.md` (new report)

## Shared files: named blocks

| File | B's block | Rule |
|---|---|---|
| `apps/web/components/editor/EditorShell.tsx` | `// capcut-B: range play` | A adds only inside `// capcut-A:` blocks |
| `docs/research/editor/README.md` | B's own row | rebase before push |

B adds no op to `ops/index.ts` and no entry to `apps/web/package.json` `check:contracts`; put tests in `*.test.ts`
next to the code (editor-core runs them). Need something in A's files? Write it under "Requests to A" in
[`A-media.md`](A-media.md) and commit.

## Every step ends with

Checks of what it touched → `/code-review` on the step's diff → fix → tick the box → **commit and push**.

## Checklist

### B0 — research report

- [x] Read the report §2–§6 and the bundles: `pretty/core-action.*.js`, zoom in `pretty/widget-2.*.js`
      (`computeZoomMax`, `ViewportAmend`), snap in `pretty/widget-db03a274.*.js` (~line 15570), the find / space /
      merge methods there (`findSpace`, `canSegmentBePlacedNearby`, `couldMerge`, `findTargetTrackIndex*`), the move
      validator, `pretty/ai-beat.*.js`, range play (`exitRangePlay`, focus range), and the canvas drawing in
      `pretty/widget-3.*.js` / `widget-4.*.js` (viewport culling, thumbnail and waveform batches).
- [x] Measure ours first: open a 30-minute upload, scroll and zoom the timeline, record frame times (Performance panel).
      This decides how much of B4 to build. *Done with a synthetic 30-minute edit in `timeline/bench/` (no local
      stack in the cloud session); numbers in the report.*
- [x] Write `docs/research/editor/2026-11-15-capcut-timeline.md` (Vietnamese): what CapCut does, what we have, the
      exact design for B1–B4, and the open questions only a runtime capture can settle. Add its row to
      `docs/research/editor/README.md`.
- [x] Review → commit → push.

### B1 — R3: zoom and snap quick wins

- [x] Zoom buttons and keys anchor on the playhead when it is on screen (the wheel keeps anchoring on the cursor).
- [x] Max zoom-out derived from the scene's duration, not a constant.
- [x] Zoom level remembered per project in `localStorage` (wrapped in try/catch), restored on open; Fit still works.
- [x] Snap threshold and playhead-first order as the report decides; the playhead highlights when a drag snaps to it.
- [x] Review → commit → push.

### B2 — R5: move rules

- [x] Write the cases first (drop over a clip, between two, past the end, on another row, multi-select across rows) as
      tests for `ops/rows.ts` / `make_room`.
- [x] Change behaviour only where the report shows CapCut's rule is clearer than ours; keep one gesture = one undo.
- [x] Review → commit → push.

### B3 — R6a: beats and range play

- [x] Beat density: every beat / every 2nd / every 4th, in `beats.ts`, shown and snapped to on the timeline.
- [x] Range play: loop the work area or the selected clips' span (button + shortcut), stops on Escape.
- [x] Review → commit → push.

### B4 — R6b: timeline drawing (size set by B0's measurement)

- [x] Draw only clips inside the visible window (plus a margin).
- [ ] Filmstrip thumbnails on video clips, drawn in idle time from the preview file, cached per zoom bucket.
- [x] Waveforms batched the same way (`peaks.ts`): drawn for the visible part only.
- [ ] Measure again on the 30-minute upload; put before/after numbers in the report.
- [ ] Review → commit → push.

## Requests to B

(A writes here.)
