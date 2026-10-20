# Plan: remove the clipping tool (and link import, and CMO video packs); keep "upload your video → edit it whole"

## Context

Owner decision (2026-10-20): clipping (long video → AI-picked moments → vertical clips) and link import (YouTube
link + "Is this your YouTube video?", yt-dlp, proxy) are what the payment providers forbid, so they go
**completely** — UI, API, engine pipeline, MCP/agent tools, tests, docs, **and the schema**. AI CMO W5 video packs
go with them. What stays: the user uploads their own long video and edits it whole in the editor; blank New edits;
the editor, export, generation, MCP editor tools. The next feature ("clips made from the edited timeline") is
built later on top of this.

Owner answers: upload + edit the whole video stays · links removed · schema cleaned in this PR · W5 removed · new
branch from #88's branch, its own PR stacked on #88.

**Key finding:** the "edit the whole upload" path is not standalone today. The only entry is the Clips tab; the
worker's `_process_full` publishes a `kind='moment'` clip, deletes the source, and never transcribes; "Edit full
video" (`create_full_edit` → `prepare_full`) reads the transcript that only the clip pipeline writes. So this PR
must build a small new upload path, not just delete.

Branch: `editor/2026-10-20-remove-clipping` from `llm/2026-10-20-provider-layer` (PR #88); PR base = #88's branch
until #88 merges, then retarget to `main`.

## Step 0 — Check production data before any drop (read-only)

Supabase MCP `execute_sql` (SELECT only): counts of `jobs` by `mode`, jobs with `segments`/`clip_length`, `clips`
by `kind`, `video_packs`, `video_ownership`, `cmo_video_briefs`, `cmo_runs`/`cmo_inbox` rows of kind `video_pack`,
`projects.kind='video_pack'`. The migration deletes or migrates whatever exists (Step 4); the counts go in the PR.

**Step 0 result (production, 2026-10-20, read-only):** `jobs` 20, all `mode='clip'` (18 done, 2 failed), none
with `segments`; `clips` 18, **all `kind='blank'`** (no `moment` or `full` clips left); `video_ownership` 2;
`video_packs` 0, `cmo_video_briefs` 0, `video_pack` runs/inbox/projects 0; 2 users ran clip jobs.
**Consequence:** blank New edits are clips under jobs whose `mode` is the default `'clip'`, so "delete every
`mode='clip'` job" would delete the users' New edits. The migration instead: deletes jobs that have **no** clip
(the 2 failed clip jobs and any job without a blank/full clip), deletes `video_ownership` rows, then sets
`mode='full'` on the remaining jobs before tightening `jobs_mode_check` (or drops `jobs.mode` if nothing reads it
after Step 3). `create_blank_edit` must stop writing `'clip'`.

## Step 1 — New upload path (build first, so the product never loses its entry)

- **UI:** an "Upload a video" button in `components/editor/EditorHome.tsx` / `ClipPicker.tsx` (next to New edit),
  reusing the existing TUS upload from the Clips panel (`/api/v1/uploads` kind `source`, `reserve_upload`) — move
  that upload code out of `ClipsPanel.tsx` before deleting it. Progress uses the trimmed `ProcessingView`.
- **API:** `POST /api/v1/editor/upload` (replaces `/editor/clipping`): zod `{ object_name, name? }`, calls a new
  RPC `create_upload_edit` (storage-only `create_job` trimmed: no URL, no segments/length/count, ownership is the
  user's own reservation). Credits held/settled as today (`credit_hold`/`credit_settle`, 1 credit/min).
- **Worker** (`worker/process_job.py::_process_full`, upload branch only), one job does it all:
  probe → settle → keep the source → `extract_audio` + `steps/transcribe.transcribe_audio` (Scribe; on failure
  publish without a transcript, editor shows "no speech" like today) → `make_editor_master` (remux, from
  `prepare_full_task`) → publish **one** `kind='full'` clip with its revision, draft, transcript and
  `masters[clip]` (reuse `prepare_full_task`'s completion — `complete_full_edit` — called from the job; verify
  its signature and make a worker-side wrapper if it needs a user context) → then delete nothing the editor reads.
- Result: upload → open in editor → whole video with transcript, cut-by-words works. `FullEditButton` and the
  separate `prepare_full` hop become unnecessary for new uploads (keep `prepare_full` only if old projects need it;
  decide from Step 0 counts).
- Tests first: engine `test_worker_process_job.py` full-mode tests rewritten for the new outputs (transcript,
  master, kind `full`); a route check for `/editor/upload`.

## Step 2 — Remove the web/MCP/agent surface

- **Delete:** `app/app/video/page.tsx` (redirect `/app/video` → `/app/editor`), `components/editor/clipping/*`,
  `components/clipping/{SourceInput,ProjectSettings,ClipResultRow,ProjectResults,clip-presentation}.tsx`,
  `components/clipping/web/{LinkPreview,YouTubePlayer,ProjectAssistant}.tsx`, `components/cmo/workspace/NewVideoPack.tsx`;
  routes `api/v1/editor/clipping/**`, `api/v1/source-preview`, `POST api/v1/jobs`, `api/v1/clips/[id]/source`,
  `api/v1/cmo/video-packs/**`, `projects/[id]/exports.zip`, `projects/[id]/transcript`; `lib/clip-options.ts`,
  `lib/clipping-contract.check.ts`, `lib/clip-presentation.check.ts`, `lib/clipping/segments*` (if carried).
- **Trim:** `EditorShell.tsx` (Clips tab, `openClips`, `?panel=clips`, "Make clips from a video…"),
  `EditorHome.tsx`, `ClipPicker.tsx` labels, `ProjectView.tsx`, `ProcessingView.tsx`, `LibraryView`, `WebShell`
  (`HREF.video`), `WorkspaceShell`, `ActiveJobs`, `app/app/page.tsx` (url/count/length redirect),
  `menus/dialogs.tsx` ("all clips" actions), `lib/clipping/create.ts` → upload-only, `lib/api/source.ts` (storage
  only), `lib/clipping-types.ts`, `lib/api/shapes.ts`, `lib/api/projects.ts`, `api/v1/projects/route.ts`.
  Keep `lib/api/clips.ts` (`clipContext`), `/uploads`, `/projects/[id]/*` (minus the two above), `/editor/*`.
- **Project assistant (multi-clip chat):** remove `lib/agent/project-tools.ts` (`list_clips`/`get_clip`/
  `apply_to_clips`), the `project` scope in `scope.ts`, `PROJECT_SYSTEM_PROMPT`, the `undo-guard` and
  `providers/fake.ts` branches.
- **CMO W5 + video briefs:** remove `lib/cmo/jobs/video-pack.ts`, the `video` agent in the registry, W5 in
  `runner/types/steps/store/memory-store/schedule/pending/load-workspace/workspace/demo`, `submit_video_pack`
  (MCP inbox), `create_video_brief` (MCP + `lib/agent/cmo-tools.ts`), `lib/cmo/brief.ts`, `cmo/video-briefs/**`,
  `BriefCards`, the video department cards in the CMO workspace UI. Video stays a *topic* in weekly plans (text
  only), no generation behind it.
- **MCP:** keep `list_clips` (reword: a project's editable video); keep `search_videos`/`get_video_transcript`
  (social research, not clipping). Update server instructions (`packages/mcp-server/src/server.ts`) and
  `lib/agent/prompt.ts` framing ("long video → vertical clips").
- **Copy:** `app/layout.tsx`, `llms.txt`, `components/landing/data.ts` (Opus Clip comparison), `lib/pricing.ts`
  ("Watermarked clips"), `lib/cmo/generate.ts`, `lib/cmo/skills/short-video.md`, the two clipping blog posts
  (remove), MCP descriptions. Landing must not mention clipping (product rule: nothing that does not work).

## Step 3 — Remove the engine clipping pipeline

- **Delete:** `pipeline.py`, `steps/select.py`, `steps/download.py`, `steps/local.py`, `quality.py`,
  `steps/reframe.py`, `worker/job_editor.py`, `worker/job_billing.py` (inline what the full path needs),
  `media/encoder.py` (after checking `render_document_task`).
- **Trim:** `steps/render.py` (keep watermark + `preview_head` + `_safe_name`), `steps/captions.py` (move
  `caption_cues` into `editing/` only if still used, else delete), `media/frame.py` (keep `ASPECT_SIZES`),
  `models.py` (keep transcript types), `config.py` (drop select/proxy/face/clip fields), `editing/*` dead helpers,
  `worker/process_job.py` (clip branch, manual segments, link branch, `UnsafeSourceError`), `worker/media.py`
  (URL validation, sections, proxies), `worker/job_uploads.py`, `worker/errors.py` (yt-dlp, proxy, select stages),
  `transcribe.py` comment, `cli.py` (delete `clip`, trim `doctor`).
- **Modal:** drop `main`/`probe`, the `opencmo-proxy` secret, the `[face]` extra, face model download, EGL apt
  packages; keep every other function. `deploy_env.py`/tests: proxy secret gone.
- **pyproject:** drop `yt-dlp`, the `face` extra (mediapipe; numpy if unused); keep `anthropic` (moderation).
- **Tests:** delete the clipping/link-only files (pipeline, select/LLM, download guard, quality, reframe, focus
  points, progressive render, captions/ASS, e2e_worker + worker_e2e_local → rewrite for the upload path); trim
  `test_worker_process_job`, `test_worker_media`, `test_render`, `test_transcript`, `test_network_timeouts`,
  `test_addresses`, `test_worker_errors`, `test_worker_lifecycle`, `test_modal_secrets`.

## Step 4 — Clean the schema (one migration + pgTAP)

New migration `supabase/migrations/2026102xxxxxxx_remove_clipping.sql`:
- Data first (from Step 0): delete `video_pack` rows in `cmo_runs`, `cmo_inbox`, `projects`; delete
  `video_packs`, `cmo_video_briefs`; **delete every `kind='moment'` clip** (owner: delete them all; production has
  none today) and **every clipping job that has no blank/full clip** (Step 0: never the jobs behind New edits),
  with dependent rows and Storage objects queued through the existing `storage_deletions` path, not by hand.
  Video briefs are removed (owner).
- Drop: tables `video_ownership`, `video_packs`, `cmo_video_briefs`; RPCs `create_clip_job`, `create_video_pack`,
  `cmo_save_video_pack`, `cmo_decide_video_pack`, `cmo_create_video_brief`, `cmo_decide_video_brief`,
  `valid_job_segments`, `video_url_refused`, `request_zip`/`request_original_zip` (if the zip route goes),
  `agent_open_project_session`; columns `jobs.segments`, `jobs.clip_length`, `jobs.clips_requested` (if no longer
  read), and their checks.
- Recreate: `create_job` → storage-only (or replace by `create_upload_edit`), `jobs_source_url_check` storage-only,
  `jobs_mode_check` → `('full')`, `clips_kind_check` → `('full','blank')`, kind checks of `cmo_runs`, `cmo_inbox`,
  `projects` without `video_pack`, `cmo_job_price`/`cmo_job_daily_limit`/`cmo_enqueue`/`cmo_memories_classify`/
  `list_projects` without the video-pack branches; the function allowlist (`182`) updated; `cmo_goals` metric
  `clips` removed or redefined.
- pgTAP: new `190_remove_clipping.test.sql` (objects gone, upload path works, a URL source refused); delete
  `060_manual_segments`, `114_cmo_video`, `125_clip_jobs`, `141_cmo_video_briefs`; rewrite `040_billing`,
  `050_web_d3_api`, `075_job_output_options`, `085_abuse_limits`, `087_hard_paywall`, `131_r7d_projects`,
  `180_private_video_urls`, `182_authenticated_function_allowlist` to the upload RPC.
- Regenerate `supabase/schema/current.sql` with `scripts/dump-schema.sh` (needs a local DB → CI or owner if the
  image still cannot be pulled here; otherwise edit by hand is not allowed — note it in the PR).
- **Deploy order** (in the PR body): Modal worker first (stops reading `segments`/`clip_length`), then
  `supabase db push`, then Vercel — or ship the migration in two parts if the worker cannot go first.

## Step 5 — e2e, docs, CLAUDE.md

- e2e: delete `editor-clipping`, `progressive-flow`, `output-options`; rework the `helpers.ts` fixtures
  (`startClipsInEditor`/`makeClipsInEditor` → `uploadToEditor`) used by `clip-flow`, `full-edit`, `editor-*`,
  `mcp`, `upload-resume`; fix YouTube seeds in `isolation`, `realtime-fallback`, `projects-delete`; trim `cmo`,
  `design`.
- `check:contracts` entries and `lib/api/contract.check.ts` cases removed/trimmed.
- Docs: `CLAUDE.md` (Project paragraph, Hard budgets → keep "peak RAM < 2 GB", replace the clip budget with an
  upload-processing budget to measure, drop yt-dlp/MediaPipe traps and "never download the whole source"),
  `README.md`, `packages/engine/README.md`, `ARCHITECTURE.md`, and a short note in the plan doc that clipping is
  gone and "clips from the edit" is next.

## Verification

- Engine: `pytest -q` + `ruff check .` green; a real upload-path run on a local file: probe → transcript →
  master → one `full` clip; peak RAM with `/usr/bin/time -v` if available (else on the owner's list).
- Web: `typecheck`, `check:contracts`, `next build`; MCP check/test/build; editor-core tests.
- DB: pgTAP via CI's `database` job (local image pull failed here earlier; retry once).
- `grep -ri "yt-dlp\|clip_length\|video_pack\|video_ownership\|make clips"` returns nothing outside history docs.
- Owner's machine: e2e with real Chrome (upload → edit → export), `supabase db push` order, Modal deploy.

## Status (2026-10-20, end of session) — PR #90 (draft, stacked on #88)

Done:
- [x] Step 0 — production counts (above)
- [x] Step 3 — engine: upload → one `full` clip; clip pipeline, yt-dlp, proxy, face, select/reframe removed (595 passed, ruff clean)
- [x] Step 4 — migration `20261220090000_remove_clipping.sql` + pgTAP (all green on local PG16 with Supabase stubs), `190_remove_clipping`, allowlist, `schema/current.sql` regenerated
  - Kept `jobs_source_url_check` admitting http(s): RPC + worker refuse links; tightening = rewriting ~50 fixtures
  - Kept job-scoped `agent_sessions` machinery (opener RPC dropped) — drop in a follow-up

Done in the second session (2026-10-20):
- [x] `lib/api/shapes.ts` / contracts JSON: clip_length, mode, segments gone; `JOB_COLUMNS` no longer reads dropped columns
- [x] Step 1 — `lib/editor/upload.ts` + `POST/GET /api/v1/editor/upload`; `components/editor/upload/UploadPanel.tsx`; tab "Upload", `?panel=upload` (old `?panel=clips` and `/app?url=` land there), menu "Upload a video…"
- [x] Step 2 — deletions listed above; `ProjectView` (processing → Open in editor; failed → retry) and `ProcessingView` (probe/download/render/transcribe)
- [x] Step 2 — CMO W5 + video briefs gone from the workspace (cards, drawer, Video Agent, goal metric `clips`, `create_video_brief`, `submit_video_pack`); video stays a calendar topic with an "Upload video" link; project assistant prompt and fake script gone
- [x] Migration: goal metric `clips` dropped (`cmo_goals_metric_check`, `cmo_put_goal`), pgTAP updated; `schema/current.sql` regenerated
- [x] Copy: landing, `<title>`, `llms.txt`, pricing, blog (clipping post removed, 308 to short-form-video-for-founders), short-video playbook, MCP descriptions, Claude plugin skill
- [x] Step 5 — e2e helpers (`uploadToEditor`, `openUploadPanel`), clipping specs deleted, specs reworked; `tests/e2e_worker.py` rewritten for the upload path; `contract.check.ts` cases removed/added
- [x] Step 5 — docs: CLAUDE.md, README, engine README, ARCHITECTURE, engine `.env.example`

Verified: web `tsc` clean, `check:contracts` green, `next build` green; MCP server check/test/build green; engine
ruff clean; pgTAP 101 files / 1527 tests green on the local Supabase stack.

Left for the owner's machine:
- [ ] e2e with real Chrome (`npm run test:e2e`), `check:api` on the live local stack
- [ ] A real upload → edit → export, and peak RAM of the upload path with `/usr/bin/time -v`
- [ ] Deploy order: Modal worker → `supabase db push` → Vercel; retarget the PR to `main` after #88 merges
