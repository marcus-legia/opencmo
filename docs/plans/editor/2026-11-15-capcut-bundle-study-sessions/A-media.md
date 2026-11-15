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

- [ ] Export menu: "Export all" and "Export selection" (the work area, or the selected clips' span).
- [ ] `render_document` takes the range; the exported file starts and ends on it (check frame 0 and the last frame).
- [ ] Cover: pick a frame from the playhead or from suggested frames; stored on the document; the export job writes a
      cover image next to the MP4.
- [ ] The Post schedule card for a founder's video shows that cover.
- [ ] MCP: `export_clip` takes the range; the cover is readable by the CMO.
- [ ] Review → commit → push.

### A3 — R4: clip tools

- [ ] `clip-doc`: freeze (a held frame of a set length), reverse, speed curve (time remap with points), with a
      migration and validation limits.
- [ ] `clip-render` and `clip-export` agree frame for frame (`editor-parity` case per tool).
- [ ] Ops in `ops/clip-tools.ts`: `freeze_frame`, `reverse_clip`, `set_speed_curve`; flip and crop only if A0 found
      them missing.
- [ ] Inspector controls for each; MCP tools wired.
- [ ] Reverse runs on the worker as a streaming ffmpeg job: measure RAM, `-ss` before `-i`.
- [ ] Look: extract frames around each effect from the full-size export.
- [ ] Review (+ security checklist: worker media, MCP) → commit → push.

## Requests to A

(B writes here.)
