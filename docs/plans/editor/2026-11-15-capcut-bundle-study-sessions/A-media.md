# Session A — media (R1 recording, R2 range export + cover, R4 clip tools)

Plan: [`../2026-11-15-capcut-bundle-study-plan.md`](../2026-11-15-capcut-bundle-study-plan.md). Runs on the owner's
laptop: it needs the local dev stack, the worker, `/usr/bin/time -v` and frame checks.

Branch: `claude/capcut-research-editor-plan-4fe196`, PR #220. No other branch or PR.

## Files this session owns

- `apps/web/components/editor/record/**` (new: the recorder panel)
- `apps/web/components/editor/upload/**`
- `apps/web/components/editor/inspector/**`
- `apps/web/components/editor/TopBar.tsx` (export menu)
- `apps/web/app/api/v1/editor/upload/**`, any new `apps/web/app/api/v1/editor/record/**`
- `packages/clip-doc/src/**` (schema, validate, migrate, timing)
- `packages/clip-render/src/**`, `packages/clip-export/src/**`, `packages/editor-parity/**`
- `packages/editor-core/src/ops/clip-tools.ts` (new), `packages/editor-core/src/ops/edit.ts` except the block marked
  for B below
- `apps/web/lib/mcp/**`, `apps/web/lib/agent/**` (tool wiring for new ops)
- `packages/engine/**` (transcode / export on the worker)
- `supabase/migrations/**`, `supabase/tests/**` (if a step needs one)
- `docs/research/editor/2026-11-15-capcut-media.md` (new report)

## Shared files: named blocks

| File | A's block | Rule |
|---|---|---|
| `apps/web/components/editor/EditorShell.tsx` | `// capcut-A: recorder` and `// capcut-A: range export` | B adds only inside `// capcut-B:` blocks |
| `packages/editor-core/src/ops/index.ts` | the registry lines for `clip-tools.ts` | B adds no op |
| `apps/web/package.json` `check:contracts` | A's new `*.check.ts` entries | B adds no entry here |
| `docs/research/editor/README.md`, `docs/plans/editor/README.md` | A's own rows | rebase before push |

Need something in B's files (a timeline button, a shortcut)? Write it under "Requests to B" in
[`B-timeline.md`](B-timeline.md) and commit; do not edit B's files.

## Every step ends with

Checks of what it touched → `/code-review` on the step's diff (+ `security-review-checklist` for uploads, worker
media, credits, migrations, MCP) → fix → tick the box → **commit and push**.

## Checklist

### A0 — research report

- [x] Read the report §5 and the bundles: `pretty/audio-recorder.*.js`, recorder and cover/highlight-frame methods in
      `pretty/src-editor-5.*.js`, `pretty/partial-export.*.js`, `pretty/cover-entrance.*.js`,
      `pretty/basic-actions.*.js`, `video.*` calls in `pretty/editor.js`. Learn the behaviour; copy nothing.
- [x] Check ours: does export honour `scene.workarea` (`packages/clip-export/src/export.ts`, `job.ts`)? Do `scaleX < 0`
      (flip) and `set_frame` (crop) already work end to end? How is `rate` timed in `clip-doc/src/timing.ts`?
- [x] Write `docs/research/editor/2026-11-15-capcut-media.md` (Vietnamese): what CapCut does for R1, R2, R4, what we
      have, and the exact design for each step below. Add its row to `docs/research/editor/README.md`.
- [x] Review → commit → push.

### A1 — R1: record in the browser

- [x] Recorder panel (`components/editor/record/`): pick mic and camera, record / pause / resume / restart, a level
      meter, a time counter. Shows the CMO script beside the camera when the edit came from a script.
- [x] Slices go to IndexedDB as they arrive (crash recovery: "Unsaved recording → Recover"); the finished take goes up
      through the existing TUS reservation path (web rule 3), never through Next.js. Streaming the upload while
      recording is left out until a measurement shows the wait after Stop matters.
- [x] Safari / Firefox: pick a `MediaRecorder` mime the browser supports; the worker treats the result as untrusted
      user media (explicit format / `USER_MEDIA_FORMATS`).
- [x] The finished take becomes a normal upload (probe → remux → transcript) and lands on the timeline at the
      playhead.
- [x] Measure the worker on a 10-minute recorded take: the length remux (stream copy) of a 10-min 720p WebM peaked at
      55 MB RSS, 0.4 s (`/usr/bin/time -v`). New-edit uploads already handled a header with no length.
- [ ] Look: record a real take in Chrome, Firefox and Safari and extract a frame and the audio from the full-size
      master. **Not done yet:** the dev stack could not run beside the e2e run on the main checkout.
- [x] Review (+ security checklist: uploads, worker media) → commit → push.

### A2 — R2: export a range, pick a cover

- [x] Export menu: "Export selection (everything in it)" and "Export selected clips only" (the selected clips' span;
      the copy's work area is set, the user's own work area stays).
- [x] `render_document` takes the range: the variant revision sets the work area the exporter already reads as its
      range; "only" hides every other node on the copy (`isolateSelection`, editor-core).
- [x] Cover: `set_cover` (scene seconds, inside the exported part), File ▸ Export ▸ "Use this frame as the cover".
      The export writes the cover as a time in its manifest (`output.cover`). **Changed from the plan:** no JPEG yet —
      the `exports` bucket accepts `video/*` only, and its migration could not be run here beside the e2e database.
      A cover image for platform uploads is a follow-up (migration + worker frame grab).
- [x] The Post schedule card opens the founder's video on that cover (`#t=` media fragment, `withCover`).
- [x] MCP: `export_clip` / `request_export` take `start`/`end`; `set_cover` is an op tool the CMO can call.
- [x] Review → commit → push.

### A3 — R4: clip tools

- [x] Freeze frame (`freeze_frame`): the clip splits at the playhead, everything that starts from there moves later,
      and a still of the clip's own source frame (drawn by the editor, saved to Media ▸ Frames) holds in its place.
      Inspector ▸ Clip tools, 1–5 s. B-roll only: the talking-head video is timed by its transcript.
- [x] Speed ramps (`speed_ramp`: montage, hero, bullet, jump cut, flash in, flash out): equal parts at constant
      speeds that average 1×, so the clip keeps its length and footage and nothing around it moves. **Changed from
      the plan:** not a true time-remap curve — the preview, export, audio and caption sync all assume a constant
      speed per clip, and stepped parts reuse that path with no renderer change. A smooth curve is a follow-up.
- [x] `clip-render` and `clip-export` agree: both tools produce only plain image and constant-speed video parts.
      Looked at a real export of each (testsrc counter frames): ramp source times 0/3/4/4/5/7 s at 0.5/2/3/4.5/6/7.5 s
      as computed; freeze holds frame 4 for 2 s then plays on from 4 s; both with sound; peak RSS 460 MB.
- [x] MCP / Assistant: `freeze_frame`, `speed_ramp`, `set_cover` are op tools with descriptions (112 MCP tools).
- [ ] Reverse. **Not built:** it needs a new worker task kind (migration, RPC, task routing), and migrations cannot
      be run here beside the e2e database. Least useful of the tools for founder videos; follow-up.
- [x] Flip / crop: unchanged (`scaleX` and `set_frame` already exist).
- [x] Review → commit → push.

## Requests to A

(B writes here.)

- [x] **From B (B1):** add `tsx components/editor/timeline/timeline.check.ts` to `check:contracts` in
      `apps/web/package.json` (B adds no entry there). It checks the timeline's snap, zoom floor and zoom anchor; it
      passes today.
