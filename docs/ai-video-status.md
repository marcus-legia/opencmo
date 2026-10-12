# AI video on the editor — status and next steps

Branch `AI-opencmo` (PR #37 → `main`). Updated 2026-10-12 (review fixes).

## What is on the branch

| PR / commit | What it does |
|---|---|
| #30 | AI runs on Anthropic, fal and ElevenLabs only. Transcripts use ElevenLabs Scribe; moment selection and moderation use Claude Haiku. AI media can be placed by time on a blank edit (no transcript needed). |
| #31 | Video agent team (`plan_video`): Writer and Motion Director agents plus a code reviewer plan an animated intro; the user approves a storyboard card; `add_intro` builds it in one undo step. |
| #32 | B-roll pack: AI stills in up to 3 variants; `pick_variant` switches them in the Inspector or the context menu. |
| #33 | Replace the background behind the speaker: an AI cut-out of the user's own video (stacked-alpha H.264) over a new background; `replace_background` op, agent tool and editor panel. |
| #34 | Slash commands in the Assistant (`/video`, `/image`, `/animate`, `/background`, `/broll`, `/intro`, `/voiceover`, `/music`) and `/video`: a Director agent writes the script and shot list, every shot is generated at once as text-to-video with the voice and music, placed by one `create_video` op. |
| #35 | Review fixes: moderation escapes `</prompt>`; background swap refuses keyframed layouts; `/video` caps shots at 18, checks in-flight generations before the card, matches shots to the model's paid lengths, refuses clips with the user's own footage; `video` guide. |
| #36 | Checked against the live APIs: video inputs are uploaded to fal (data URLs are rejected), the real VEED cut-out result is parsed, NSFW and Scribe fixtures; never resubmit a paid job when fal is busy (poll, fetch, output moderation); per-shot `/video` moderation; music repeats past 60 s; Haiku price rows and Haiku 5.5 defaults; `npm run dev:credits`. |
| `d9a8619` | `opencmo clip --transcribe` / `modal run … --transcribe` to measure through speech-to-text; reframe drops weak face detections next to a sure face (a bookshelf was pulling the crop off the speaker). |
| `d5baad5` | Cut-out stacking probes the picture size instead of `scale2ref` (ffmpeg 7.1 aborted now and then). |
| `ab944a5` | Long audio is transcribed in parallel ~10-minute parts; links pull ~48–70 kbps audio so no re-encode is needed. |
| `7e0eb6b`, `ed9653b` | Security review: speech-to-text audio is read through the demuxer allowlist, capped at 18 parts (3 hours), and refused when its length cannot be read. |
| `edit_video` (PR on `ai-edit-video`) | Plan B: the Assistant (`edit_video`, `/edit`, an `edit` guide) and the editor (right-click the speaker → "Edit with AI…") redraw 3–10 s of the user's own video from words with Kling O1 Edit. Catalog flag `clipVideo` on the edit models; SQL `ai_check_spec`, `catalog.py` and editor-core accept the clip's own `renders:`/`sources:` refs for them (upscale still library-only); the result is a muted layer over the speaker in the same box, following face tracking, one undo; moderation of the frames uses the own-footage policy when the source is the clip's own video. |
| Review fixes | Transcript parts: a stream copy starts at the container's seek point before `-ss` (a WebM cluster, up to 5 s early), so each part's real first second is read back (`-copyts`) and its words are shifted by that, not by the nominal cut; parts also start 2 s before their window, so a word on a cut is kept once; parts are cut inside the pool. Output moderation runs Haiku 5.5 at low effort and retries a verdict cut off by `max_tokens` instead of blocking it. Cut-outs of the user's own footage skip the "identifiable real person" rule; voice and audio scripts get their own text policy (names and brands allowed, voice cloning still blocked). Background removal reuses a live generation when the clip's master changed under the same declaration (no second charge). `/video` moderates every piece at once before holding credits. `--transcribe` also applies to picked moments; unreadable library audio says so; `keep_alignable` removed. |

## Budget measurements (54-minute interview, 5 clips)

| Where | Route | Transcript | Select | Sections | Render | Total | Peak RSS |
|---|---|---|---|---|---|---|---|
| Local, h264_vaapi | file, Scribe in one call | 48–58 s | 4–11 s | 0 s | 34–46 s | 87–112 s | 244 MB |
| Modal, libx264 | YouTube link, Scribe in one call | 107 s | 11 s | 118.5 s | 39 s | **286 s (over)** | — |

Not yet measured end to end after `ab944a5` (parallel parts, lighter link audio). Locally, extracting the audio of 54 minutes takes 14–19 s and Scribe answers in ~40 s in one call; the link route on Modal also pays the proxy for both the audio and the sections.

Cutting the parts alone (54 minutes, 6 parts, 4 vCPU, no Scribe call), measured 2026-10-12 in a cloud container: one copy per part, serial (`ab944a5`) 3.1–3.4 s; copy + offset read-back + remux, in the pool (review fixes) 2.2–2.6 s; re-encoding to Opus 32 kbps was 7–9 s and was dropped. Peak RSS per ffmpeg 50–54 MB. On a 25-minute beep track cut at 600 s and 1200 s, every beep lands within 10 ms of its source time, none twice.

## Plan

### A. Budget: 45-minute video → 5 clips in under 3 minutes, peak RAM < 2 GB

Still open: needs the bench interview, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY` and Modal, none of which the review-fix session had.

1. Re-measure locally with `--transcribe` (run twice, keep the second):
   `/usr/bin/time -v .venv312/bin/opencmo clip clips/bench/interview.mp4 --clips 5 --out clips/bench/out --transcribe --verbose`
   Expect the transcript step near extraction + one part (~15–25 s).
2. Re-measure on Modal through a link: `modal run modal_app.py --url <link> --clips 5 --transcribe`.
3. Measure the upload route on Modal (the main path): a bench entrypoint that reads the file from a Modal Volume (`modal volume put`), so the run takes the local-file route like an uploaded job. The upload is downloaded from storage first in production; add that time.
4. If the link route stays over budget, the remaining cost is the section download through the proxy. Options, in order: start the section downloads for the top moments while the slower parts finish; download fewer, tighter sections; accept that the budget is defined on the upload route and document it. Decide with numbers.
5. Look at a frame of each full-size clip (not `*.preview.mp4`): speaker in frame, captions on screen.
6. Update "Last measurement" in `CLAUDE.md`.

### B (5.2). `edit_video`: the Assistant edits video by prompt — done (see the table above)

The path mostly exists: `resolveClipVideo` maps `assets/master.mp4`, the worker signs `renders:`/`sources:`, video inputs are uploaded to fal. Only three gates keep edit models off the clip's own video.

1. Catalog flag `clipVideo: true` on `fal-kling-edit` and `fake-edit` (`packages/contracts/ai-models.json` + a migration on `ai_models.limits`). The gates accept clip refs when `removeBackground || clipVideo`: SQL `ai_check_spec` (full `create or replace`, pgTAP: own master and proxy allowed; another user, wrong bucket, missing object refused; upscale still refused), `opencmo/ai/catalog.py validate_spec`, `packages/editor-core/src/generate.ts`.
2. Op `edit_video` (`packages/editor-core/src/ops/edit-video.ts`, `agent: false`): `{element_id?, start, end, model, prompt, seed, references?}`. The source is the master piece covering the range (export `masterFor` from `ops/background.ts`) or a library video element. Duration `ceil(end - start)` within the model's 3–10 s; frames 9:16 or 16:9 (no new aspect ratios). Places one muted "AI edit" layer above the source with the same box, objectFit and face-tracking keys (`shiftTrack`); one undo. vitest for placement, `sourceStart` and refusals.
3. Agent tool `apps/web/lib/agent/edit-tool.ts` (template `background-tool.ts`), priced approval card, wired in `scope.ts` (`PRICED_TOOLS`, `isWriteTool`, moderation), `eval/run.ts`, slash `/edit`, an `edit` guide, a fake-agent branch, eval `videoedit`, a `check:api` case.
4. Editor: "Edit with AI…" also on the speaker video (`EditorShell.tsx videoSourceOf` stops excluding `assets/master.mp4`).

### C (5.1). Chained shots in `/video`

The Director may mark a shot as continuing the previous one (same scene, no cut). That shot starts from the previous shot's last frame; other shots still start in parallel. One card, one total, one undo.

1. Identity: the continuing shot's spec carries `after: <parent spec_hash>` (part of its own hash); new column `generations.after_id`.
2. SQL migration + pgTAP `147_chained_shots`: task status `awaiting_input` (never claimed); `ai_check_spec` allows `after` for `firstFrame` models only, not with `startImage`; `create_generation` resolves the parent in the same job and user (row lock) and creates the task waiting unless the parent is done; `complete_generation` releases children; `sync_generation_from_task` fails and refunds waiting children when a parent fails or is cancelled (cascades); `cancel_generation` includes `awaiting_input`; `reclaim_expired_tasks` as a safety net. Regenerate `supabase/schema/current.sql`.
3. Worker: `_continuation_frame` checks the parent (same user and job, done, `spec_hash == after`), downloads its file (capped), extracts the last frame (`-f mov -sseof -0.5 -i … -update 1`), runs `check_input`, passes it as `startImage`; after a won completion, wake the children (`run_task.spawn` on Modal, local poll otherwise).
4. Web and editor-core: `after` in the spec schema, clip-doc declaration and `add_generated`; `checkShots` rejects `after` on shot 1 and needs the predecessor at its full length; Director `continues` (rare, ≤ 2 in a row, `MAX_CHAIN = 3`); card wait = typical time × longest chain; card and storyboard say which shots continue; `useGenerations` passes `after` so the editor's re-POST reuses the child.
5. Tests across pgTAP, vitest, pytest (last frame of a red→blue clip is blue; mismatched owner, hash or status refused; disguised HLS parent refused), `check:api`; one real 2-shot chain on fal, frame at the seam looked at.

### Still open, not in this plan

- Credit prices (`agent_credits`, per-model prices) — owner decision.
- Kling edit and SeedVR upscale with uploaded video have not been called live.
- fal runs only a few requests at once on a new account (up to 40 as credits are bought); long `/video` runs can wait longer than the card's estimate.

## Verify before merging #37

Engine `pytest -q` and `ruff`; `npm run typecheck`; `cd apps/web && npm run check:contracts && npm run check:api`; `npm run agent:eval -- --provider fake`; editor-core and clip-doc vitest; `supabase migration up` + `supabase test db`; e2e in CI. Deploy needs `ANTHROPIC_API_KEY` and `FAL_KEY` on Vercel, `ANTHROPIC_API_KEY` in the Modal `opencmo` secret, and the migrations applied before the web code.
