# Plan: learn from CapCut Web's bundles, then update the editor (2026-11-15)

**Scope (owner, 2026-11-15): learn all six tracks (R1–R6) and build them into the editor.** Each track still starts
with a short research report, then is built. Two sessions work in parallel on one branch and one PR; see
"Order and sessions" and the checklists in [`2026-11-15-capcut-bundle-study-sessions/`](2026-11-15-capcut-bundle-study-sessions/).

## Sources

- **Report:** `../opencmo-internal/docs/specs/2026-11-09-hoc-capcut-timeline.md` — static read of CapCut Web's
  timeline: architecture, time units and zoom, snap ("adsorb"), edit operations, the Data SDK, open questions (§6).
- **Bundles:** `../opencmo-internal/research/bundles/capcut/` — 244 minified JS files captured from
  `capcut.com/editor` on 2026-11-09 with REA; 22 prettified in `pretty/` (288k lines, `editor.js` alone is 186k).
  Raw REA evidence is local-only in `research/captures/capcut/`.

**Rules (from the bundle README, binding):** CapCut's code has no licence for us. Read it to learn the behaviour, then
write our own in our architecture. Copy no code, strings, schemas, function names or assets into this repo. Never run,
import or build the bundles. Read the report first; open a bundle only to check a detail.

## Strategy check

The owner's 2026-11-08 order puts the AI CMO loop first and the editor last. So this plan ranks every track by one
question: **does it help a founder turn the CMO's script into a posted video?** (The founder makes the videos; the CMO
writes the script and caption they record from.) Tracks that only make the timeline nicer come after.

## What we already match (no work)

Checked in `apps/web/components/editor/timeline/` and `packages/editor-core/src/ops/`:

| CapCut (report §) | Ours |
|---|---|
| Log ("geared") zoom slider (§3) | `Timeline.tsx` slider over `log(ppf)` |
| Zoom keeps the time under the cursor fixed (§3, `ViewportAmend`) | `zoomTo(next, clientX)` on ctrl/cmd-wheel |
| Snap to clip edges, playhead, beats, markers; skip the dragged clip's own edges; group edges (§4) | `snap.ts` (`snapTargets`, `snapDelta`), in frames rather than pixels |
| Snap on/off switch (§4 `switches.adsorb`; toolbar "attach") | `snap` toggle |
| Drag previews, release commits, one gesture = one undo step (§5) | gesture → `onPreview`, commit on release |
| Move to another track / new track on drop (§5) | `move_to_row`, row past the last one |
| Split at playhead, markers, beats, keyframes, ripple delete | `onSplit`, `set_marker`, `beats.ts`, `move_keyframe`, `ripple_delete` |
| Constant speed (§5 `video.setSpeed`) | `rate` in `clip-doc` schema |
| Retakes ("multiple takes", "magic cut") | `find_retakes`, `remove_silence`, word cuts |

## Gaps found in the bundles

From the report and a pass over every prettified chunk (method names, feature keys and toolbar entries only):

1. **In-browser recording** (`audio-recorder`, 4.2k lines): mic + camera device pickers, pause/resume/restart, chunked
   upload while recording, IndexedDB copy of the draft so a crashed tab can recover, transcode, then the take lands on
   the timeline as a new segment. We have no `getUserMedia` path: a founder must record elsewhere and upload.
2. **Export a selected clip / range** (`partial-export`): "download selected clip" and "download all selected" next to
   full export. We have `set_workarea`; whether export honours it is to be checked.
3. **Cover / thumbnail picker** (`cover-entrance`, `src-editor-5` "highlight frame", `captureNearbyFrameUris`): pick
   or suggest a cover frame, stored on the draft. Post cards need a cover for TikTok/Reels/Shorts.
4. **Clip tools in the timeline toolbar** (`basic-actions`): freeze frame, reverse, flip, crop, smart crop, curve speed
   (speed ramp with a preview axis). We have none of freeze/reverse/curve speed; flip and crop to be checked against
   `scaleX` / `set_frame`.
5. **Timeline zoom details** (report §3): button and key zoom anchored on the **playhead** (ours anchors on the panel
   centre); max zoom-out derived from the duration; zoom level remembered per user + project; snap threshold 6 px
   (ours 10 px); the playhead is tried first and highlights when hit.
6. **Move rules and track choice** (report §6 unknowns; `widget-db03a274`: `findSpace`, `canSegmentBePlacedNearby`,
   `couldMerge`, `findTargetTrackIndex*`; the move validator): what CapCut does when a drop would overlap.
7. **Timeline drawing** (`widget-3`, `widget-4`): the track area is drawn on a canvas scene graph with viewport
   culling, idle-time thumbnail and waveform batches (`createImageBitmap`) and filmstrip thumbnails. Ours draws clips
   as DOM with no filmstrip. Matters only if a long upload makes our timeline slow — measure first.
8. **Beat detection with a frequency setting** (`ai-beat`): every beat / every 2nd / 4th. Ours finds beats with no
   density control.
9. **Range play** (`exitRangePlay`, focus range): loop playback over a selection.

Out of scope, by our rules: template / "cut same" / batch replace, digital humans, matting and background removal of
people, voice effects, vocal separation of someone else's track, Dropbox / Google Drive import of other people's media.

## Research tracks, ranked

Each track starts with a report in `docs/research/editor/` (Vietnamese, per `docs/research/README.md`) that ends in
the exact design to build, then the session builds it. The ranking sets the order inside each session.

| # | Track | Why (CMO loop) | Bundle files to read | Our files to compare |
|---|---|---|---|---|
| R1 | **Record in the browser** (gap 1) | The founder records from the CMO's script; recording inside OpenCMO removes the hop through another app. Highest value. Still "video must be the user's own". | `pretty/audio-recorder.*.js`; recorder entries in `src-editor-5` | `apps/web/components/editor/upload/`, TUS upload path, `jobs` for transcode; RAM budget in the worker |
| R2 | **Export a range and pick a cover** (gaps 2, 3) | A clip cut from a finished edit, with a cover, is what a Post card schedules. | `pretty/partial-export.*.js`, `pretty/cover-entrance.*.js`, cover / highlight-frame methods in `src-editor-5` | `set_workarea`, `packages/clip-export`, `save_frame`, Post schedule card |
| R3 | **Timeline quick wins** (gaps 5, 9) | Small, cheap, felt on every edit. | report §3–4; `pretty/core-action.*.js`, `widget-2` zoom (`computeZoomMax`), `widget-db03a274` snap | `Timeline.tsx` `zoomTo` / `fit`, `snap.ts` |
| R4 | **Clip tools** (gap 4) | Freeze and speed ramps are common in short-form edits; reverse less so. | `pretty/basic-actions.*.js`; `video.*` calls in `editor.js` | `clip-doc` schema (`rate`), `clip-render`, `clip-export` |
| R5 | **Move rules** (gap 6) | Fewer surprising drops; only if founders hit them. | `widget-db03a274` find/space/merge methods; report §6 | `move_to_row`, `make_room`, `rows.ts` |
| R6 | **Timeline drawing and beats** (gaps 7, 8) | Only after a measurement shows a slow timeline on a 30-minute upload. | `pretty/widget-3`, `widget-4`, `ai-beat` | `Timeline.tsx`, `peaks.ts`, `beats.ts` |

What each report must answer:

- **R1:** the recording states and what survives a tab crash; how chunks upload while recording; how the take is
  placed on the timeline; what we would build on TUS + a reservation (web rule 3) without passing files through
  Next.js; the transcode's peak RAM against the 2 GB budget; browser support (Safari `MediaRecorder` codecs).
- **R2:** what "export selected" exports (one clip, a range, several clips into one file or many); how the cover is
  chosen and suggested; whether our export already takes a range; the smallest change so a Post card gets a clip and a
  cover from one finished edit.
- **R3:** the exact deltas to adopt (anchor, threshold, max zoom, memory key) with before/after numbers; each is a
  few lines in `Timeline.tsx`.
- **R4:** the document shape each tool needs (freeze = a held frame of given length; curve speed = time remapping) and
  its cost in `clip-render` and `clip-export`, both of which must agree frame for frame (`editor-parity`).
- **R5:** CapCut's rules for a drop that overlaps (push, new track, refuse) against ours, with cases.
- **R6:** a measurement of our timeline on a long upload first; only if it is slow, how culling and thumbnail batching
  would fit `Timeline.tsx`.

## Runtime check (owner, optional)

The report is static. The open questions in its §6 (`refTimes`, `clipType`, `actionOperateType`, the move validator)
need CapCut running. If a track's report cannot settle one from the bundles, it lists it, and the owner runs a REA
capture at home (`inspect_web_page` on `capcut.com/editor`, with workers allowed this time). The render engine (VESDK
/ WASM) is not needed: our renderer stays `clip-render`.

## Order and sessions

All six tracks are built. Two sessions, split by area so they never edit the same file:

| Session | Runs on | Tracks, in order | Owns |
|---|---|---|---|
| **A — media** | the owner's laptop (local dev stack, worker, `/usr/bin/time`, frame checks) | R1 recording → R2 range export + cover → R4 clip tools | recording UI, upload/transcode path, `clip-export`, `clip-render`, `clip-doc` schema, new editor-core ops, inspector, MCP tools |
| **B — timeline** | a second Claude account (cloud) | R3 quick wins → R5 move rules → R6 beats, range play, drawing | `apps/web/components/editor/timeline/**`, `playback.ts`, `shortcuts.ts`, `editor-core` `ops/rows.ts`, `beats.ts` |

Exact files, shared-file blocks and numbered checklists: [A](2026-11-15-capcut-bundle-study-sessions/A-media.md),
[B](2026-11-15-capcut-bundle-study-sessions/B-timeline.md). Neither waits on the other; no building block is shared.

**Branch and PR:** both sessions work on `claude/capcut-research-editor-plan-4fe196` and PR #220. Neither opens its
own branch or PR. Pull (rebase) before every push.

**Every step ends the same way:**

1. Run the checks of what it touched (`npm run typecheck`, the package's tests, `check:contracts` for web, pytest +
   ruff for the engine; RAM measurement for any ffmpeg change; a frame extracted from the full-size export for
   anything that renders).
2. **Code review:** run `/code-review` on the step's diff (and the `security-review-checklist` skill when the step
   touches uploads, the worker's media pipeline, credits, migrations or MCP tools). Fix what it finds, or write in the
   session file why a finding was left.
3. **Commit and push** to the shared branch at once, with a message in English. Tick the box in the session file in
   the same commit.

**Access for session B:** the second account needs read access to `marcus-legia/opencmo` and
`marcus-legia/opencmo-internal` (the bundles are committed there; the REA captures are not, and are not needed).

## Not doing

Copying any CapCut code or text. Templates and batch replace. A second renderer or a WASM engine. Anything that brings
in media the user did not make.
