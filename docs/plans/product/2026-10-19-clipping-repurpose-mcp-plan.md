# Plan: clip picker, cheap downloads, repurpose and AI CMO over MCP (2026-10-19)

Track: product · PR: [#84](https://github.com/marcus-legia/opencmo/pull/84) · Work split: [sessions](2026-10-19-clipping-repurpose-mcp-sessions.md)

Facts below were checked on `main` at `83821c69`.

## Owner decisions (2026-10-19)

1. **What we sell:** the editor and the AI CMO with its three departments (Video, Post, Sales). Clipping is the way a
   user's own long video gets into the editor; it is not sold on its own. This is consistent with `CLAUDE.md`
   "Strategy": the editor is the spearhead and what we sell first.
2. **No API budget.** Anthropic and Gemini credit is gone, fal has about 1–2 $, ElevenLabs still has credit, Modal
   runs. Nothing in this plan may add a server-side Anthropic, Gemini or fal call. Thinking goes over MCP: the
   user's own Claude does it (`brain: 'claude'`, the inbox, `preview_explainer`).
3. **Moderation moves to Groq** (owner, 2026-10-19, replacing the Anthropic top-up): `GROQ_API_KEY` is already in the
   environments. Prompt moderation is a product rule and a payment provider requirement, so it stays; only the model
   behind it changes (item 3). No Anthropic top-up.
4. **Clipping must let the user pick segments by hand.** The picker moved from its own page into the small editor
   panel on 2026-10-04 and lost segment picking. AI picking is removed (decision 8).
5. **Downloads must be cheap.** The IPRoyal proxy bill feels too high; measure first, then cut bytes.
6. **Everything outside this plan gets a Beta badge** saying it is still being finished.
7. **Out of scope, owner handles it:** Polar and payment policy, pricing, any new ownership-verification scheme,
   landing page changes.
8. **Manual picking only.** The user picks every moment. No user, API or MCP path runs the `select` step; AI moment
   picking is gone from the product. `steps/select.py` stays in the engine for the dev CLI; do not delete it.
9. **IPRoyal has no credit; links stay as they are.** Link jobs fail until the proxy is back or removed (O5).
   Uploads do not use the proxy (`worker/process_job.py:147` reads the signed Storage URL), so upload is the path that
   works today.

Phase ES of the [editor roadmap](../editor/2026-10-19-editor-spearhead-roadmap.md) needs generated media (fal); it
waits for budget. This plan is the zero-API work that makes the sold product usable now.

## Goal and why

- A user uploads (or pastes their own YouTube link), **picks the moments on a full-size player and timeline**, and gets
  clips without any LLM call on our side. Only the picked sections are downloaded.
- If captions cannot be made (no subtitles and speech-to-text fails), the user still gets the raw cut clips (item 8).
- Each clip opens as an edit and can be **repurposed** with a voiceover (ElevenLabs, manual UI) or an explainer
  (the user's Claude over MCP: `preview_explainer` → `add_explainer`).
- The **AI CMO runs fully over MCP** in production: every job goes to the inbox and the user's Claude answers it.
- **Drafts are ready every morning without the user typing anything** (item 9): a scheduled task in the user's own
  claude.ai works the inbox through our connector; the user only approves and posts.
- Proxy work (item 2) waits until IPRoyal has credit again.

## Facts checked

**Segment picking already works below the UI.**
- `apps/web/lib/clipping/create.ts:38` accepts `segments` (≤ 10, 1–180 s each, no overlap: `segmentProblem` at
  `:51`), refuses a link without `ownership_confirmed` (`:70`) and falls back to AI selection when `segments` is
  empty (`:75`).
- `create_clip_job` / `create_job` (`supabase/migrations/20261027090000_clip_jobs.sql`,
  `20261210200000_private_video_urls.sql`) validate and store `jobs.segments`.
- Engine: `worker/process_job.py:70` `chosen_moments()` and the manual branch of `pipeline.py` (≈ `:262-290`):
  probe → download only those sections → transcript of those sections only (YouTube subtitles, else ElevenLabs
  Scribe). **No LLM call.** Covered by `tests/test_pipeline_manual_moments.py`.

**The picker UI was deleted.**
- Commit `d1f6d623` (2026-10-04, on the `claude/*` branches; `main` starts at a squashed root) removed
  `components/clipping/web/CreateProject.tsx`, `ClipStudio.tsx`, `SegmentBar.tsx` and
  `components/clipping/OutputOptions.tsx`.
  - `SegmentBar` had: two handles per segment, dragging seeks the player, 1–180 s, ≤ 10, no overlap, `freeGap` for a
    new 30 s moment.
  - Recover with `git show d1f6d623^:apps/web/components/clipping/web/SegmentBar.tsx`. *(2026-10-20, Session A: the
    commit is in neither repository's history now, on any branch or PR ref, so `SegmentBar` was written again from
    this description.)*
- `components/clipping/web/YouTubePlayer.tsx` (`useYouTubePlayer`, IFrame API on youtube-nocookie) still exists, but
  nothing uses the hook. CSP already allows it (`next.config.ts`).
- `components/editor/clipping/ClipsPanel.tsx` never sends `segments`.

**AI selection needs Anthropic.** `steps/select.py` calls Claude only (`Config.validate_for_select`); there is no
fallback but evenly spaced windows for videos with almost no speech. A clip job with no `segments` takes this branch
(`pipeline.py:221`), and so do the two "Try again with longer clips" buttons (`ClipsPanel.tsx:385`,
`ProjectResults.tsx:131`). Decision 8 closes all of them.

**A failed speech-to-text fails the whole job.** On the manual branch `_transcript_for_moments` (`pipeline.py:111`)
tries ready-made subtitles first; `fetch_subtitles` already returns `None` on error (`download.py:260-271`). Without
subtitles it calls ElevenLabs Scribe per section, and `transcribe_audio` raises on a missing key, an empty quota or a
network error. The sections are already cut, but the job fails. Rendering already copes with an empty transcript
(`render.py:155-159`, and the comment at `pipeline.py:278`: the clip comes out without captions).

**Every yt-dlp call goes through the proxy** (`steps/download.py:81` `_base_opts`). These multiply bytes
(inferred, not measured):
- `probe` (`:108`), `fetch_subtitles` (`:243`), `download_audio` (`:277`) and each section (`:359`) re-extract the
  watch page and player JS.
- `fetch_subtitles` runs even when `probe` knows there are none, and also on the manual branch.
- With no subtitles, the AI branch downloads the full audio.
- `SECTION_ATTEMPTS = 3` (`:345`) and each retry starts over. `modal.Retries(max_retries=1)` on `run_job` /
  `run_task` (`modal_app.py:364`, `:386`) reruns the whole job.
- `SECTION_FORMAT` (`:330`) ends in `/best[height<=1080]/best`: no https constraint and no cap on the last fallback.
- `probe` and `fetch_subtitles` have no retry and no new IP.

**The two failed downloads** are one video, `lETIcbAzZ40`, on 2026-10-14: "The video provider blocked access…" and
"The connection was interrupted…".

**Repurpose today.**
- Voiceover: Generate → Voiceover tab, a manual path that does not need the Assistant. It runs `moderateText`
  (`lib/generate/create.ts:128`), so today it needs credit on `ANTHROPIC_API_KEY`; after item 3 it runs on Groq.
- Captions: Inspector → Generate captions (Scribe), manual. Translation needs an LLM.
- Explainer: Assistant or MCP only.

**Moderation shares the general Anthropic key.** It reads `ANTHROPIC_API_KEY` in
`apps/web/lib/generate/moderation.ts:36` and `packages/engine/opencmo/ai/moderation.py:129`. The in-app Assistant,
every CMO agent and `select.py` read the same key. Moderation moves to Groq (decision 3, item 3), and this plan keeps
the other readers from spending it by default: the CMO thinks over MCP (item 4) and AI moment picking only runs when
the user asks (item 1). The in-app Assistant still spends it when used.

**CMO brain.**
- `lib/cmo/brain.ts:42` ignores `OPENCMO_BRAIN=claude` in production. A key with no credit still counts as up until
  a call fails, so cron runs fail and refund instead of going to the inbox.
- `create_video_pack` enqueues without a brain.
- In-app onboarding (`lib/cmo/onboard.ts`) has no inbox path. Over MCP the `/onboard` prompt works today.
- Open review findings on the inbox: `docs/mcp-agent-team-sessions.md:356-372`, items 1, 3, 4, 5 and 6.

**Beta badge** is a CSS class only (`.beta-badge`): `components/editor/TopBar.tsx:88`,
`components/clipping/WorkspaceShell.tsx:224`.

**MCP has no tool that makes clips.** Agents may not confirm ownership (`lib/agent/prompt.ts:80`).

## Work items

Each item names its check. Where a check is a test, it must fail on today's code first.

### 1. Full-size clip picker — Session A

A dedicated full-size picker, shown as an overlay over the editor, not the small panel.
- **Open it from:** the Clips tab after a file is uploaded (or a link pasted), and from `/app/video`. The URL is
  `/app/editor?panel=clips&picker=open` (contract A1); `EditorShell.tsx:354` already reads `panel=clips`.
- **Video:** a `<video>` on the signed URL for uploads and the YouTube IFrame player for links (`useYouTubePlayer`).
- **Timeline:** the restored `SegmentBar` under the player. Add a moment with "Add a moment" or keyboard `I`/`O` at
  the playhead.
- **Options:** frame and captions on/off (from `OutputOptions` and `ClipsPanel`). No clip count and no clip length:
  each picked moment is one clip, and its length is the moment's length.
- **Submit:**
  - Picked moments are sent as `segments`.
  - "Make clips" stays disabled until at least one moment is picked. There is no AI-pick button (decision 8).
  - Uploads keep `mode: "full"` (the whole video into the editor, no segments).
  - The ownership checkbox stays as it is.
- **Manual-only guard, in three layers** (`CLAUDE.md` web rule 2):
  - zod: `createClipJobInput` (`lib/clipping/create.ts`) requires `segments` with at least one moment when
    `mode` is `"clip"`, error "Pick at least one moment to clip." Both `/api/v1/jobs` and `/api/v1/editor/clipping`
    use it.
  - SQL: a migration changes `create_job` (latest in `20261210200000_private_video_urls.sql`) to refuse
    `mode = 'clip'` without segments and to set the clip count to the number of segments. pgTAP for it.
  - Worker: `worker/process_job.py` fails a clip job that has no `segments` and no stored `moments` artifact with a
    clear English error, and never runs the AI branch of `run_pipeline`.
- **Remove "Try again with longer clips"** in `ClipsPanel.tsx` and `ProjectResults.tsx`. Replace it with "Pick again",
  which opens the picker with the job's source and moments.
- **Prefill:** the picker reads `&source=<url>&segments=<start>-<end>,…` (seconds) to come in pre-filled. This is a
  contract with item 5.
- **After the job finishes:** each clip shows "Open", plus "Add voiceover" and "Add explainer" hints. The hints open
  the edit with the Generate → Voiceover tab, or show the MCP `/explain` route.
- **Check:**
  - An e2e that picks two moments on an upload. The job row has `segments`, the clips match the lengths ±1 s, and the
    worker log has no `select` step. Run the same on a link only locally, where downloads do not need the proxy.
  - The e2e submits with no moment and gets a 422; a pgTAP case for the same in `create_job`; a pytest case for the
    worker guard. Each fails on today's code first.
  - Look at one frame of the full-size output, per `CLAUDE.md` "Verify by looking".

### 2. (Deferred) Measure the proxy, then cut bytes

Deferred on 2026-10-19: IPRoyal has no credit, so nothing can be measured, and the owner keeps links as they are
(decision 9). Pick this up when the proxy has credit again. The sub-items below stay as the plan for that day.

Warning from the plan review: googlevideo URLs may be bound to the IP that extracted them. "Extract once" must then
keep one sticky session from probe to the last section (`Config` already picks one session per job, `config.py:113`)
and must extract again whenever `fresh_proxy_session` gives a new IP (section retries do, `download.py:392`). 2a has to
find out whether the URLs are IP-bound before 2b starts.

- **2a. Measure.** Count extractions and bytes per job, split by call type (probe, subtitles, audio, section,
  retry), and log one summary line per job. Reproduce `lETIcbAzZ40` and record which call failed and why.
  - **Check:** the summary line for two 5-moment manual jobs, before any change, written into this
    plan.
- **2b. Cut bytes.**
  - Extract once: reuse the probe's info dict for subtitles and sections where yt-dlp allows it.
  - Skip `fetch_subtitles` when the probe says there are none.
  - Give the last `SECTION_FORMAT` fallback `protocol^=https` and a height cap.
  - Retry only the failed section.
  - Do not let `modal.Retries` rerun a job that has already stored its sections.
  - **Check:** pytest cases that fail first (extraction count with a fake extractor; no subtitle call when the probe
    says none). The same two jobs re-measured: fewer bytes and fewer extractions.
  - Budgets hold: peak RAM < 2 GB and a 45-minute video → 5 clips in < 3 minutes, measured with `/usr/bin/time -v`.
- **2c. Reliability.** `probe` and `fetch_subtitles` retry on a fresh proxy session like sections do. Map
  "blocked" vs "interrupted" to messages that say what to try.
  - **Check:** a pytest case where the first probe fails with a retryable error and the second succeeds.

### 3. Moderation on Groq — Session C (do first)

Moderation is the only server-side model call left that the sold product needs: voiceover (`moderateText`), every
Generate request and every generated image or video frame go through it. Today it reads `ANTHROPIC_API_KEY`, with
Gemini as standby, and both have no credit, so every check fails closed ("Could not check this request").

- **Web, prompt text** (`apps/web/lib/generate/moderation.ts`): Groq becomes the primary checker through its
  OpenAI-compatible chat API (`https://api.groq.com/openai/v1/chat/completions`, `GROQ_API_KEY`), same `POLICY` /
  `AUDIO_POLICY`, same `verdictSchema` through `response_format: { type: "json_schema", strict: true }`. Model from
  `OPENCMO_MODERATION_GROQ_MODEL`.
- **Worker, images and video frames** (`packages/engine/opencmo/ai/moderation.py`): fal's NSFW classifier stays as
  the first check; the policy check (real people, logos) moves to a Groq vision model, the same frames as data URLs.
  Model from `OPENCMO_MODERATION_GROQ_VISION_MODEL`.
- **Pick the models from the live list, not from memory.** Groq's model list changes often. Before coding, list the
  models with the key (`GET https://api.groq.com/openai/v1/models`) and check the structured-outputs docs: the text
  model must support strict `json_schema` (candidates: `openai/gpt-oss-safeguard-20b`, made for policy moderation,
  or `openai/gpt-oss-20b`); the vision model must accept images and at least JSON mode (validate with the pydantic
  `_Verdict` either way). Write the chosen ids and the date into this item.
- **Order:** Groq first; Anthropic and Gemini stay as standby only when their keys are set, with the existing rule:
  a verdict is final and is never retried on another model; only an outage or an account error falls through.
  If no checker can answer, refuse, as today.
- `moderationReady()` (and `ready()` in Python) count Groq as a checker. `deploy_env.py` stops requiring
  `ANTHROPIC_API_KEY` for moderation and requires `GROQ_API_KEY` on Vercel and the worker (the MCP and motion apps keep
  what they need for their own reasons; read why each requires it before removing anything).
- The policy text and the categories do not change.
- **Check:**
  - `moderation.check.ts` and the engine moderation pytest, with a fake Groq server: a clean prompt passes, a policy
    prompt is blocked with its category, a Groq 401/429/5xx falls through to standby or refuses, a malformed answer
    refuses. Each new case fails on today's code first.
  - One real call per checker with the production key (a clean prompt and a blocked one), logged in this plan with
    the latency.
  - A voiceover from the Generate panel works end to end with no Anthropic credit.

### 4. AI CMO over MCP in production — Session C

- `OPENCMO_BRAIN=claude` is honoured in production (`lib/cmo/brain.ts`). When it is set:
  - `classify_edits` is skipped in `app/api/cron/cmo`.
  - `create_video_pack` passes `brain: 'claude'`. This needs a migration.
  - W0 onboarding (`components/cmo/CmoView.tsx`) offers "Continue in Claude" with the `/onboard` prompt instead of
    calling the server model.
- Fix inbox findings 1, 3, 4 and 5 of `docs/mcp-agent-team-sessions.md:356-372`, one migration plus pgTAP each where
  SQL changes.
- Finding 6: wake the worker (`wakeWorker`) after `inbox_submit` and after a `brain: 'claude'` start, so a replay
  does not wait for the minute sweep.
- Let `create_task` start `summarize_memory` and `review_week`.
- **Check:**
  - pgTAP for each migration; `brain.check` for the production flag.
  - On production with the flag set, "Plan my week" creates an inbox item, not a `cmo_runs.error`. This one runs
    only after O2 and O4; the session lists it in the PR body as a post-deploy check and is not blocked by it.
  - A full week over MCP runs end to end: `plan_week` → `post_draft` → approve → `review_week`.

### 5. Clips from MCP without giving up the human step — Session B

- MCP tool `make_clips(url, segments)` creates **no job**. It validates the segments with `segmentProblem` from
  `lib/clipping/segments.ts` (at least one moment) and returns the picker link from item 1, pre-filled. The user
  confirms ownership and presses Make clips. The user's Claude suggests moments for free; the human checks them and
  keeps the ownership step.
- Links only: the user's Claude cannot see an upload before it is transcribed. The tool description says link jobs
  need the download proxy (decision 9).
- The tool body lives in `apps/web/lib/mcp/`; `packages/mcp-server/src/groups/clips.ts` only registers it, like the
  other groups.
- **Check:** `server.check.ts` cases for valid segments (returns a link) and overlapping segments (returns an error
  result). A manual run in claude.ai opens the picker pre-filled.

### 6. Beta badges — Session C

- A `BetaBadge` component that replaces the two inline spans.
- Shown on the AI CMO workspace (Post, Sales), the Generate panel and the 3D kinds. Text: "Beta: we're still
  finishing this. Expect some bugs."
- **Check:** a typecheck, plus a look at each surface in light and dark themes.

### 7. Editor-over-MCP checklist — Session C

- `docs/evals/mcp-editor-checklist.md`: the free tasks of `apps/web/lib/agent/eval/tasks.ts`, rewritten for a real
  fixture clip, plus behaviour rules from the agent research (`docs/research/agents/2026-10-17-agent-evals-draft-signal.md`
  §7 and the Opus notes in the internal repo):
  - no write before the user answers a question;
  - at most one question per turn;
  - call `check` and `capture_frame` (item 10) before saying done;
  - never confirm a price alone;
  - no regeneration on timeout;
  - `read_guide` before a new kind of edit.
- The first flow covered is **clip → voiceover → explainer → export**, on an uploaded fixture video (links need the
  proxy, decision 9).
- **Check:** one full run through claude.ai, results in `docs/evals/results/2026-10-xx.md`. Every failure gets either a
  guide or tool-description fix or an issue.

### 8. Raw clips when captions cannot be made — Session B

- In `_transcript_for_moments` (`pipeline.py:111`), a Scribe error on a section is logged as a warning and that
  section gets no captions; the job goes on. If every section fails, the transcript is `Transcript(segments=[])`.
- The user gets the cut clips without captions and can add them later with Inspector → Generate captions.
- Nothing new: keep `source="scribe"` with empty `segments`, so `clipping-types.ts` and the SQL checks do not change.
  `mode: "full"` is untouched; it needs no transcript.
- **Check** (pytest, failing first):
  - No subtitles and a fake Scribe that raises: the job returns every clip, the files exist, the transcript is empty.
  - Two sections, Scribe works on the first and fails on the second: only the first has captions.
  - Look at one frame of a full-size output: no captions, the frame is right.

### 9. Daily drafts from the user's claude.ai — Session C (after C1 and C2)

Today the inbox only moves when the user opens Claude and types `/inbox`. The goal is that every morning the X draft
(and the Reddit replies, on sales days) already wait in Approvals, with no server model call.

**Why claude.ai pulls and we do not push** (research 2026-10-19):
- MCP is client-initiated: our server answers tool calls and cannot open a claude.ai conversation. claude.ai's
  custom-connector docs list tools only; nothing says it supports MCP sampling, and sampling would need an open session
  anyway. There is no public API to fire a claude.ai (Cowork) scheduled task.
- **Cowork scheduled tasks** (claude.ai, all paid plans) run remotely on Anthropic's servers on an hourly, daily,
  weekday or weekly cadence, and use the connectors on the user's claude.ai account. Remote tasks cannot use local
  folders or local connectors; our server is a remote connector (URL + OAuth), which is the kind they can use.
  Sources: [scheduled tasks](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork),
  [remote execution](https://support.claude.com/en/articles/15811196-what-to-expect-with-remote-execution-in-claude-cowork),
  [custom connectors](https://support.claude.com/en/articles/11175166).
- Not confirmed by any official page: that a *custom* connector loads in a scheduled run. Community reports describe
  connectors missing from scheduled runs
  ([#42033](https://github.com/anthropics/claude-code/issues/42033),
  [#43397](https://github.com/anthropics/claude-code/issues/43397),
  [#40835](https://github.com/anthropics/claude-code/issues/40835)). 9a settles this before any code.
- **Fallback: Claude Code routines** ([docs](https://code.claude.com/docs/en/routines)) have an API trigger
  (`POST …/routines/<id>/fire` with a per-routine token), so our cron could wake the user's Claude exactly when an inbox
  item opens. Costs: it is a Claude Code session (the form asks for a GitHub repo), the user pastes a token we must
  store encrypted, and the endpoint is behind an experimental beta header. Only if 9a fails.
- Free claude.ai plans have no scheduled tasks; they keep `/inbox` by hand.

**Sub-items:**
- **9a. Spike (owner run, under half a day, after O2 and O4).** Create one daily Cowork scheduled task on the owner's
  claude.ai with the OpenCMO connector and the prompt from 9c. Let it run on two mornings. Record in this plan:
  - does the run see our tools;
  - does the OAuth token refresh without the user (Supabase OAuth access tokens are short-lived; the run is
    unattended);
  - did it submit, and did a card land in Approvals;
  - how long the run took and how much of the Pro usage it used.

  If the connector does not load or the token does not refresh, switch 9b to routines and note why here.
- **9b. Set-up card in the app.** "Draft every morning in Claude" in the "Continue in Claude" card and on the CMO
  workspace:
  - numbered steps: add the connector, open Cowork → Scheduled, new task, daily;
  - the prompt with a Copy button;
  - a suggested time in the user's time zone that falls after the 00:05 UTC cron.

  Copy describes software ("Claude drafts, you approve and publish"), no model names as features.
- **9c. Unattended mode for the CMO tools.** A scheduled run has nobody to answer:
  - a `/daily` MCP prompt and a matching section in `plugins/opencmo-claude/skills/opencmo/SKILL.md`: work every open
    inbox item until `list_inbox` is empty; never ask the user; never confirm a price; skip and report an item it
    cannot finish;
  - the server cannot tell an unattended run from a live one, so no server-side mode: the existing two-step price →
    confirm already spends nothing without a confirm, and the prompt forbids confirming. Submitting (`submit_*`)
    stays free.
- **9d. Tell the user.** The Approvals count shows in the app's nav. Email is out of scope: there is no mail provider
  in the app yet; note it as a follow-up.
- **Check:**
  - `server.check.ts` case for the `/daily` prompt (registered, says "never ask", "never confirm a price").
  - 7 days in a row on production: every day with an X item due has a card in Approvals before 9:00 local, 0 server
    credits spent, nothing posted. Results in `docs/evals/results/`.

### 10. Let Claude look and listen over MCP — Session B

**Why:** over MCP, Claude edits blind. The in-app Assistant has six tools that run in the user's browser
(`BROWSER_TOOLS` in `apps/web/lib/agent/tools.ts:312`, `{ browser: true }`): `capture`, `media_waveform`,
`preview_3d`, `save_frame`, `media_grab`, `inspect_color`. `packages/mcp-server/src/groups/studio.ts:258` drops every
browser tool, so over MCP Claude only has the transcript, `check` and `preview_explainer` stills. It cannot catch the
silent failures `CLAUDE.md` "Verify by looking" warns about (half-cropped speaker, captions off-screen, overlaps).
`clip-render` already draws a document in Node (`@napi-rs/canvas`) for `clip-export`, so the same frames can be
rendered on the worker with no outside API.

**Tools** (same names and inputs as the in-app ones where they exist, so guides and skills keep one vocabulary):
- **10a. `capture_frame`** (in-app `capture`): render frames at clip-timeline seconds exactly as the export draws
  them, as one contact sheet with a timecode per cell and the 0.25/0.5/0.75 guides, plus per frame the visible layers
  top-first with id and 0–1 box. Up to 12 times per call. This is the one to build first.
- **10b. `inspect_color`**: the same render, measured with `scopeStats` from `clip-render` (black/white point,
  median luma, crushed and blown share, RGB averages, 16-bin histogram). Needed so `apply_color` over MCP is not
  guesswork.
- **10c. `media_grab`**: frames at given seconds of a library video or image, as a contact sheet, so Claude can
  pick the part of a B-roll file that fits. ffmpeg only (`-ss` before `-i`, explicit format per budget rule 7).
- **10d. `media_waveform`**: coarse dB levels and silent stretches of the clip's own video (source seconds, ready
  for `remove_ranges`) or of a library file. ffmpeg `astats` / `silencedetect` on the audio stream of the signed URL,
  streaming; never the whole file into memory.
- **10e. `save_frame`**: one frame without captions or text saved to the library folder Frames, for
  `generate_media` start/end images. Low priority while fal has no budget; build it after 10a–10d.
- **10f. Versions:** `list_versions` and `restore_version` over the existing revisions
  (`app/api/v1/editor/revisions/route.ts`, `checkpoint_editor_project`). MCP has no `undo`, so today a bad edit can
  only be reverted by the user in Version history. Read the revisions RPCs first; add one only if no
  ownership-checked restore exists.
- Not now: `preview_3d` (GPU worker, 3D is outside this plan).

**How:**
- One Modal function on the existing worker image (it already runs `clip-export` and ffmpeg), for example
  `look(payload)`: loads the clip document and media under the user's ownership (the same reads as
  `render_document`), renders only the asked frames, returns JPEGs plus the layer boxes. No MP4 is encoded.
- Tool bodies in a new MCP group `packages/mcp-server/src/groups/look.ts`; results come back as MCP image content
  plus the same JSON text the in-app tool returns (Claude Code shows `structuredContent`, so repeat the text as
  `message`, as B10 found).
- Free for the user, but each call costs us Modal time: a per-user hourly cap in its own `rate_limit_hit` bucket
  (`mcp_look`, 60/h to start), and a timeout below Modal's 150 s web cut. If a contact sheet cannot finish in time,
  return `{ id, status }` and a poll, like exports.
- Budgets: peak RAM < 2 GB per call, measured with `/usr/bin/time -v`. Decode only the frames asked (input
  seeking), never the whole source.
- Update the opencmo server instructions and the guides: they now say "there is no browser here"; replace that with
  "call `capture_frame` after changing the frame, cutting, adding text or media, and before you finish".
- **Check:**
  - `server.check.ts` cases: each tool is registered with `clip_id`; `capture_frame` refuses more than 12 times and
    times outside the clip; the cap returns an error result.
  - A clip-export test that the frame from `look` and the same frame of an exported MP4 match (the parity script in
    `editor-parity` or a pixel diff under a small threshold).
  - Look at one contact sheet by eye, per "Verify by looking".
  - The item 7 checklist run uses `capture_frame` before every "done", and records whether Claude caught a planted
    problem (captions pushed off-screen in the fixture).

## Owner tasks (not code)

- **O1** (Replaced by item 3: no Anthropic top-up.) Make sure `GROQ_API_KEY` is set on Vercel and in the worker's
  Modal secret, and set the two `OPENCMO_MODERATION_GROQ_*` model ids that item 3 writes down.
- **O2** Set `OPENCMO_BRAIN=claude` on Vercel after item 4 ships.
- **O3** Run `cd packages/engine && .venv312/bin/modal run check_deploy_env.py` after O1 and O2. It must print
  `Deploy env OK.`
- **O4** Deploy:
  - `supabase db push` for C's migrations;
  - Vercel through the merge;
  - `supabase db push` also for A's `create_job` migration;
  - `modal deploy modal_app.py` for A's worker guard, B's raw-clip fallback (item 8) and the worker moderation on
    Groq (item 3);
  - `npm run build --workspace @opencmo/mcp-server && modal deploy mcp_app.py` for items 5 and 10;
  - `modal deploy modal_app.py` also for item 10's `look` function.
- **O5** Top up IPRoyal, **or** remove `OPENCMO_PROXY` from the worker's Modal secret. With an empty IPRoyal account
  every link job fails at probe. Without the secret, yt-dlp goes out through the built-in guard proxy
  (`capture/guard.py:244`, no setup) from Modal's IPs, which YouTube may block. `deploy_env.py` does not require
  `OPENCMO_PROXY`.
- **O7** For item 10: one new value, `OPENCMO_LOOK_TOKEN`, in both the `opencmo` (worker) and `opencmo-mcp` secrets, and
  `OPENCMO_LOOK_URL` (the `look` endpoint printed by `modal deploy modal_app.py`) in `opencmo-mcp`.
- **O6** Run the item 9a spike on your own claude.ai (paid plan, Cowork) after O2 and O4, then the 7-day check.

## Not doing

- Polar, payment policy, pricing, new ownership verification, landing page copy (owner).
- Onboarding without a website (needs its own research first).
- AI moment picking of any kind (decision 8); proxy work until IPRoyal has credit (item 2); the in-app Assistant or CMO chat on a server model; caption translation.
- Phase ES generation items (`/video`, AI B-roll); they wait for budget.
- Automatic posting of any kind, including scheduled publishing of approved posts through the X API (item 9 only
  drafts; the user still presses post). Email notifications (no mail provider yet).
