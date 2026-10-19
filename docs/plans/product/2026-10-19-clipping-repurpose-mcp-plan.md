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
3. **About 5 $ of Anthropic credit tops up the existing shared key** (`ANTHROPIC_API_KEY`); no separate
   moderation key. Prompt moderation is a product rule and a payment provider requirement, so it stays.
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
  - Recover with `git show d1f6d623^:apps/web/components/clipping/web/SegmentBar.tsx`.
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
  (`lib/generate/create.ts:128`), so it needs credit on `ANTHROPIC_API_KEY`.
- Captions: Inspector → Generate captions (Scribe), manual. Translation needs an LLM.
- Explainer: Assistant or MCP only.

**Moderation shares the general Anthropic key.** It reads `ANTHROPIC_API_KEY` in
`apps/web/lib/generate/moderation.ts:36` and `packages/engine/opencmo/ai/moderation.py:129`. The in-app Assistant,
every CMO agent and `select.py` read the same key. The owner keeps one shared key (decision 3), so this plan keeps
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

### 3. (Dropped) A moderation-only key

Dropped by the owner on 2026-10-19: moderation keeps using the shared `ANTHROPIC_API_KEY`. The number is kept so the
other items keep theirs.

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
  - call `check` before saying done;
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

## Owner tasks (not code)

- **O1** Top up about 5 $ of Anthropic credit on the existing account. No new key and no secret changes: Vercel,
  `opencmo` and `opencmo-mcp` already hold `ANTHROPIC_API_KEY`.
- **O2** Set `OPENCMO_BRAIN=claude` on Vercel after item 4 ships.
- **O3** Run `cd packages/engine && .venv312/bin/modal run check_deploy_env.py` after O1 and O2. It must print
  `Deploy env OK.`
- **O4** Deploy:
  - `supabase db push` for C's migrations;
  - Vercel through the merge;
  - `supabase db push` also for A's `create_job` migration;
  - `modal deploy modal_app.py` for A's worker guard and B's raw-clip fallback (item 8);
  - `npm run build --workspace @opencmo/mcp-server && modal deploy mcp_app.py` for item 5.
- **O5** Top up IPRoyal, **or** remove `OPENCMO_PROXY` from the worker's Modal secret. With an empty IPRoyal account
  every link job fails at probe. Without the secret, yt-dlp goes out through the built-in guard proxy
  (`capture/guard.py:244`, no setup) from Modal's IPs, which YouTube may block. `deploy_env.py` does not require
  `OPENCMO_PROXY`.

## Not doing

- Polar, payment policy, pricing, new ownership verification, landing page copy (owner).
- Onboarding without a website (needs its own research first).
- AI moment picking of any kind (decision 8); proxy work until IPRoyal has credit (item 2); the in-app Assistant or CMO chat on a server model; caption translation.
- Phase ES generation items (`/video`, AI B-roll); they wait for budget.
