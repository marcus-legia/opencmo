# Studio: the video department

Status: **proposed** (2026-10-25), research before build. Markdown twin of [`studio.html`](studio.html), written for
agents; the two must say the same thing. Parent pages: [`ai-cmo.md`](ai-cmo.md), [`brain.md`](brain.md).

Studio is the editor plus the Video agent team. It makes every visual deliverable (AI long videos, shorts cut from a
finished edit, slideshows, post images) and hosts the founder's hands-on edits of their own video.

## 1. Verdict

**Studio is the most built department:** one write path (`editor-core` ops), one renderer for preview and export,
server export on Modal; four built squads (long take, intro, explainer + 3D, B-roll + images); 12 slash commands; 26
models; three callers share it (Assistant chat, MCP, and the brain as proposed).

**To become a department it needs:** one Studio adapter extracted from MCP's studio group; a "finished" state and
export of a named timeline; three new squads (Shorts, Slideshow, Post image); a look check on the full-size export
before any card.

Ranked by the editor strategy: Shorts first (every OpenCMO video becomes 3 shorts), then Slideshow (cheap, no video
model), then Post image.

## 2. Studio today (`main`, `eb858ca`)

| Part | Where | What it does | State |
|---|---|---|---|
| Document + ops | `packages/clip-doc`, `packages/editor-core` | JSON document; every change is an op; the only write path for buttons, Assistant, MCP | built |
| Render + export | `clip-render`, `clip-export`, task `render_document` | same Canvas 2D renderer in browser and worker; export draws the active timeline over its workarea | built; Modal production run open (E0.1) |
| Assistant | `lib/agent/` | tools = ops; 12 slash commands (`/style`, `/video`, `/image`, `/animate`, `/background`, `/edit`, `/broll`, `/intro`, `/voiceover`, `/music`, `/roughcut`, `/explain`); 22 eval tasks | built |
| Video agent team | `create-video.ts`, `long-take.ts`, `video-team.ts` | long take (director, code reviewer, keyframes, text checker, shots, voice + music, builder); intro (writer, motion director, reviewer, builder) | built; long-take Tasks 0, 1, 8 open |
| Generation | `lib/generate`, `ai-models.json` | 26 models: images (nano-banana, seedream, Gemini), video (Veo, Kling, Kling v3, Seedance, Hailuo, Gemini), edit, upscale, cutout, voices, music, SFX, explainer, 3D; moderation both ends | built |
| MCP studio group | `packages/mcp-server/src/groups/studio.ts` | every clip tool without a chat: plan → signed confirm → decide | built |
| Look | Modal `look`, `opencmo.worker.look` | draws up to 12 frames with the export renderer for Claude over MCP; nothing stored | built, untested on Modal |
| Finished state, named-timeline export, shorts, slideshow, post image | none | — | missing |

**Naming trap:** the table `clips` is the editor's project unit (`kind` `full | blank`), and code calls a project a
"clip" (`clip_id`, `ClipDocument`). Proposal: short videos cut from an edit are **shorts** in code (`kind = short`, op
`make_short`, order `cut_shorts`); user-facing copy stays "cut short clips from your finished video".

## 3. What Studio makes

| Deliverable | Who starts it | Squad | Paid steps | State |
|---|---|---|---|---|
| AI long video | brain, founder, MCP | Long take | keyframes, shots (two cards) | built |
| Own video, edited | founder only, hands-on | Assistant + ops | only what the founder asks | built; "finished" new |
| Shorts from a finished edit | brain (event: video approved), founder | Shorts | none | new |
| Slideshow | brain (week plan), founder | Slideshow | AI images only when needed | new |
| Post image, cover, thumbnail | brain (a post needs one), founder | Post image | one image, or none | `/image` exists |
| Intro, explainer, 3D, B-roll | inside a video | built squads | per card | built |

## 4. What others teach

| Source | What it is | Take | Leave |
|---|---|---|---|
| OpusClip (ClipAnything, Virality Score) | picks moments from dialogue, visuals, sentiment; 0–99 score from hook, flow, value, trend | the criteria as reasons: a hook that grabs and fits the topic, logical flow with a satisfying end, one idea of value | a single "virality" number we cannot back; clipping others' or linked videos |
| Descript Underlord | agentic co-editor on the transcript; saved prompt "Create Social Clips" | shorts are edits: same ops, transcript, undo; saved prompts ≈ recipes and style skills | credits per chat turn without a price card |
| ClipsAI (MIT) | TextTiling with BERT embeddings over a word-timed transcript; resize with diarization | topic-shift segmentation for long own videos, rewritten in TypeScript | Python frame work; WhisperX |
| Active-speaker report (2026-10-18) | Scribe diarization + mouth openness; clip-forge split rules | reframe for two-person shorts | — |
| Agent Opus (internal) | planner + expert pipeline, keyframes first, two cards | same squad shape: LLM step, code reviewer, builder | AGPL code |
| Higgsfield (internal) | AI Employees = skills + memory; spend approval | squads as named employees; price before render | face and recreate features |
| VideoDB Director (MIT) | open-source video agent framework, 20+ agents, typed outputs | typed outputs per squad | a Python agent runtime |
| ReelFarm, SlideStorm, SlidesTok | TikTok slideshow tools, $19–99/month; SlidesTok: landing URL → slides | demand is real; URL → slides is what our onboarding documents hold | posting farms, many accounts |
| TikTok Content Posting API | photo posts: up to 35 images, cover index, `auto_add_music`; unaudited apps post privately | slideshow outputs a PNG set as well as MP4 | — |
| Opus remakes + Claude Design (report 2026-10-22) | spec with numbers + render → look → fix loop | the look check in every squad | — |

## 5. Design: one adapter, seven squads, shared tools

Every squad has the long take's shape: LLM step → code reviewer (sends back once) → builder (ops) → renderer.

- **Callers:** brain (work order + brief), founder in the editor (chat, buttons, slash commands), MCP (founder's
  Claude with its own plans).
- **Studio adapter** (`lib/departments/studio`, new, extracted from MCP's studio group): entry points from the
  registry (`create_video`, `animate_video`, `redo_keyframe`, `plan_video`, `cut_shorts`, `make_slideshow`,
  `make_post_image`); plan → card → decide (brain cards go to the Approval inbox); every call under the founder's
  RLS session (a brain order mints a short-lived user JWT as MCP does); checks the order's remaining credits before
  a card offers to spend; writes a deliverable (`kind`, `parent_id`, `editor_project_id`) with a status.
- **Squads:** Long take, Intro, Explainer + 3D, B-roll + image (built); Shorts, Slideshow, Post image (new).
- **Shared:** `editor-core` ops (only write path, Version history per write); generation (credit hold, spec hash);
  moderation (prompt before credits, image + 3 frames after); `render_document` (one export per timeline); look check
  (new: Modal `look` + a vision judge).
- **Inputs:** marketing documents and Brand Kit; media library and uploads; transcripts (Scribe words, voice-over word
  timings); captured pages; style skills.
- **Outputs:** deliverables `kind = video | short | slideshow | image`, cards in the Approval inbox, approved →
  Schedule. Editing the founder's own video produces a deliverable only when the founder marks the edit finished.

## 6. Shorts squad

Only from an edit the founder marked finished, in the founder's own project. No generation credits.

Chain: Segmenter (code) → Clip editor (LLM) → Clip reviewer (code) → Builder (`make_short`) → Renderer → Look check.

| Step | AI long video | Founder's own video |
|---|---|---|
| Words with times | voice-over word timings and the plan's beats | Scribe words; diarization |
| Segmenter (code) | beats are the candidates | sentence ends + pauses + speaker turns; topic shifts (ClipsAI style) for long talks |
| Clip editor (LLM) | ranks 5–8 candidates of 15–60 s, returns 2–5 with hook line, title and reasons (hook, flow, value); one cheap call | same |
| Clip reviewer (code) | starts and ends on a sentence; hook in the first 3 s; length per platform; no name or number split; no overlap; sends back once | same |
| Builder (`make_short`) | copy timeline, set workarea; already 9:16 when the video is | copy, workarea, 9:16 with face or active-speaker reframe |
| Style | a style skill (hook title, captions with emphasis, punch-ins) through the same op path | same |
| Renderer + look check | one `render_document` per short; frames from the full-size file before the card | same |

## 7. Slideshow squad

A slideshow is a document of timed slides: same ops, renderer, export; no new runtime.

Chain: Writer (LLM) → Reviewer (code) → Visuals → Builder → Renderer → Look check.

- Inputs: brief from the week plan, marketing documents, Brand Kit, captured pages of the founder's own site.
- Writer: 5–10 slides; slide 1 is the hook; one idea per slide; last slide is a call to action; No AI Slop rules.
- Reviewer: text fits, no invented numbers, banned words.
- Visuals: the founder's screenshots and captured pages first; an AI image only when needed, moderated, never with
  text inside the image. Text is always an editor layer.
- Outputs from one document: **MP4** (Reels, Shorts: timed slides, transitions, optional music bed) and a **PNG set**
  (TikTok photo mode up to 35 images with a cover index; Instagram and LinkedIn carousels), one card for both.

## 8. Post image squad

For a post that needs a picture, a video cover or a YouTube thumbnail (roadmap E4.2). Prefer a frame of the founder's
video or a captured page with a title layer; generate only when none fits. Aspect per platform, text as a layer,
Brand Kit fonts and colours. `/image` makes the image; the recipe, title layer and deliverable are new.

## 9. Quality gates

| Gate | Where | State |
|---|---|---|
| Moderation of prompts and outputs | `lib/generate/moderation.ts`, `opencmo/ai/moderation.py` | built |
| Garbled text on keyframes | long take F9 | built |
| No double payment | spec hash, request id | built |
| Look check | Modal `look` draws up to 12 frames of the full-size export; a vision judge answers fixed questions (captions inside the frame, no black or frozen frames, text readable, sound present); a failure goes back to the squad once, then to the card with a note | new |
| Brand fit | fonts, colours, logo from the Brand Kit | `apply_brand` exists |

## 10. Evals

| Squad | Measure |
|---|---|
| Long take | Task 0 / Task 8 frames: frozen shots, jumps at shot boundaries, garbled text; credits and wall time per 60 s |
| Shorts | approved as is; code-check pass rate (hook in 3 s, whole sentences); views per short from `post_metrics` |
| Slideshow | approved as is; text fits on every slide; time from brief to card |
| All | look check pass rate; credits per approved deliverable; the Assistant's 22 eval tasks stay green |

## 11. Build phases

- **S0** Finish the long take: open Tasks 0, 1, 8 and the release; one real 60 s OpenCMO video on production.
- **S1** Studio adapter (extracted from MCP's studio group, MCP unchanged) + "finished" state + named-timeline export.
- **S2** Shorts squad: AI long videos first (beats known), then the founder's own finished edits.
- **S3** Slideshow and post image squads (MP4 + PNG set from one document).
- **S4** Look check (vision judge on `look`) + Studio evals.

S0 is on the editor roadmap. S1–S2 make marketing videos (every video → shorts) and line up with E4.1 and E4.5. The
brain's B3 needs S1.

## 12. Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | Shorts from the founder's own finished edits too? | both; AI videos first (S2), own edits once "finished" exists; the source is always a finished edit in the founder's project |
| 2 | Shorts per video by default | 3 |
| 3 | Approve one by one or as a batch? | one card, each short with its own approve and skip |
| 4 | Name in code `short` instead of `clip`? | yes |
| 5 | Slideshow outputs MP4 and PNG set? | both from one document |
| 6 | Look check on every render or only before a card? | only before a card |

## Sources

Code: `packages/editor-core`, `packages/clip-export`, `apps/web/lib/agent/` (`slash.ts`, `create-video.ts`,
`long-take.ts`, `video-team.ts`, `scope.ts`), `packages/mcp-server/src/groups/studio.ts`,
`packages/engine/modal_app.py` (`look`), `packages/contracts/ai-models.json`, `supabase/schema/current.sql` (`clips`);
plans `docs/plans/editor/2026-10-19-editor-spearhead-roadmap.md`, `2026-10-23-ai-long-take-plan.md`; reports
`docs/research/editor/`.

Outside:
- https://help.opus.pro/docs/article/virality-score (quoted via search results; the page did not load here)
- https://www.opus.pro/blog/best-video-clipping-tools
- https://help.descript.com/hc/en-us/articles/36803785502221-Underlord-beta-Your-AI-co-editor-in-Descript
- https://github.com/ClipsAI/clipsai (MIT), https://www.clipsai.com/references/clip
- https://github.com/video-db/Director
- https://ai.g2.com/marketplace/tools/reelfarm, https://ai.g2.com/marketplace/tools/slidestorm, https://trustmrr.com/startup/slidestok (prices unverified)
- https://developers.tiktok.com/doc/content-posting-api-reference-photo-post
