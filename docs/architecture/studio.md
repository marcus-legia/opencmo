# Studio: the video department

Status: **built** (`main` at `4f70a59`, 2026-11-08). Designed 2026-10-25, built in phases S0–S4 (P1–P6) and the CMO
review (#169–#180). Markdown twin of [`studio.html`](studio.html), written for agents; the two must say the same
thing. Parent pages: [`ai-cmo.md`](ai-cmo.md), [`brain.md`](brain.md).

Studio is the editor plus the Video agent team. It makes every visual deliverable (shorts cut from a finished edit,
slideshows, post images, and the AI long video) and hosts the founder's hands-on edits of their own video.

**Where Studio sits now (owner, 2026-11-08).** The AI CMO leads and the editor comes last: Studio builds from words the
founder already approved (step 4 of the loop in [`ai-cmo.md`](ai-cmo.md) §2), and the editor is where the founder
fine-tunes by hand at the end. **`/video` is to be hidden** (owner decision): the full AI video (`create_video`) is
built, and plan S2.4–S2.5 remove it from the web app, the landing page and the week plan; at `4f70a59` they still
offer it. The code, the MCP tool and the evals
stay. Every other slash command stays as it is.

## 1. Verdict

**Built:** one write path (`editor-core` ops), one renderer for preview and export, server export on Modal; the Studio
adapter shared by the brain, the Assistant and MCP; a "finished" state; squads for the long take, intro, explainer,
B-roll and images, shorts, slideshow and post image; a look check before a card; 12 slash commands; 25 models; charge
before running on every paid job.

**Left:** the post image squad has no caller (nothing outside the acceptance runs creates a `build_post_image` order);
`/video` is still offered in the web app until plan S2.4 hides it, and its leftovers (the contact-sheet branches) are removed by plan S2.8; making `/video` cheaper and
showing it again gets its own plan.

## 2. Studio as built (`main`, `4f70a59`)

State: ✅ done · 🟡 partial · ❌ not built.

| Part | Where | What it does | State |
|---|---|---|---|
| Document + ops | `packages/clip-doc`, `packages/editor-core` | JSON document; every change is an op; the only write path for buttons, Assistant, MCP | ✅ |
| Render + export | `clip-render`, `clip-export`, tasks `render_document`, `render_stills` | same Canvas 2D renderer in browser and worker; export draws a named timeline over its workarea; stills for the PNG set | ✅ |
| Assistant | `lib/agent/` | tools = ops; 12 slash commands (`lib/agent/slash.ts`: `/style`, `/video`, `/image`, `/animate`, `/background`, `/edit`, `/broll`, `/intro`, `/voiceover`, `/music`, `/roughcut`, `/explain`); 42 eval tasks (`lib/agent/eval/tasks.ts`) | ✅ · `/video` still offered; plan S2.4 hides it |
| Video agent team | `create-video.ts`, `long-take.ts`, `video-team.ts`, `explainer-tool.ts` | long take (one storyboard card, one job hold, every piece in one go); intro; explainer (plan → preview → add) | ✅ |
| Generation | `lib/generate`, `packages/contracts/ai-models.json` | 25 models: images (nano-banana, seedream…), video (Veo, Kling, Kling v3, Seedance, Hailuo, Kling edit), upscale, cutout, voices, music, SFX, explainer and motion clips (Remotion); Creem screens prompts, the worker reviews outputs | ✅ |
| Studio adapter | `lib/departments/studio/adapter.ts`, `types.ts` | eight entry points (`plan`, `decide`, `buildVideo`, `cutShorts`, `markFinished`, `renderShort`, `buildSlideshow`, `buildPostImage`) for the brain, the Assistant and MCP | ✅ |
| MCP studio group | `packages/mcp-server/src/groups/studio.ts` | every clip tool without a chat: plan → signed confirm (600 s) → decide | ✅ |
| Finished state | `mark_finished`, `lib/departments/studio/finished.ts` | the founder marks an edit finished at the document hash they saw; a later save clears it (`editor_projects_clear_finished`) | ✅ |
| Shorts | `lib/departments/studio/shorts/`, op `make_short`, `short_batches`, `shorts` | 3 shorts from a finished edit, one batch card | ✅ |
| Slideshow | `lib/departments/studio/slideshow/`, `clips.kind = slideshow`, ops in `editor-core/src/ops/slides.ts`, `components/editor/slides` | Slides view in the editor; MP4 and PNG set from one document | ✅ |
| Post image | `lib/departments/studio/slideshow/post-image.ts`, `20261231120000_p5_post_image.sql` | one still from a frame or a captured page with a title layer; shown on its post's card | 🟡 no caller yet |
| Look check | task `look_check`, `opencmo/ai/look_judge.py`, `look_checks` | §9 | ✅ |
| Studio lists editor edits (#177) | `components/screens/studio/` | the founder's own edits from their first save, finished or not; a vertical edit of 60 s or less is filed under Shorts | ✅ |
| The editor keeps the server's library (#176) | `mergeLibrary` (`packages/clip-assets`), `DocumentSession.rebase` | the tab merges the server's manifest instead of overwriting it, so pieces `/video` listed are not lost | ✅ |

**Naming trap:** the table `clips` is the editor's project unit (`kind` `full | blank | short | slideshow`), and code
calls a project a "clip" (`clip_id`, `ClipDocument`). Short videos cut from an edit are **shorts** in code (`kind =
short`, op `make_short`, order `cut_shorts`); user-facing copy stays "cut short clips from your finished video".

## 3. What Studio makes

| Deliverable | Who starts it | Squad | Paid steps | State |
|---|---|---|---|---|
| Own video, edited | founder only, hands-on | Assistant + ops | only what the founder asks | ✅ "Mark finished" |
| Shorts from a finished edit | brain (event: edit finished), founder ("Cut shorts") | Shorts | none | ✅ |
| Slideshow | brain (week plan: `write_slides` → `build_slideshow`), founder | Slideshow | AI images only when needed | ✅ |
| Post image, cover, thumbnail | — | Post image | one image, or none | 🟡 no caller |
| Intro, explainer, B-roll, images, voice-over, music | inside a video, from the editor | built squads | one card each | ✅ |
| AI long video | brain (`build_video`), founder (`/video`), MCP | Long take | one card: keyframes, shots, voice, music | ✅ built; to be hidden in the web app (S2.4) |

## 4. What others teach

| Source | What it is | Take | Leave |
|---|---|---|---|
| OpusClip (ClipAnything, Virality Score) | picks moments from dialogue, visuals, sentiment; 0–99 score from hook, flow, value, trend | the criteria as reasons: a hook that grabs and fits the topic, logical flow with a satisfying end, one idea of value | a single "virality" number we cannot back; clipping others' or linked videos |
| Descript Underlord | agentic co-editor on the transcript; saved prompt "Create Social Clips" | shorts are edits: same ops, transcript, undo; saved prompts ≈ recipes and style skills | credits per chat turn without a price card |
| ClipsAI (MIT) | TextTiling with BERT embeddings over a word-timed transcript; resize with diarization | topic-shift segmentation for long own videos, rewritten in TypeScript | Python frame work; WhisperX |
| Active-speaker report (2026-10-18) | Scribe diarization + mouth openness; clip-forge split rules | reframe for two-person shorts | — |
| Agent Opus (internal) | planner + expert pipeline, keyframes first, an approval before each paid stage | same squad shape: LLM step, code reviewer, builder | AGPL code |
| Higgsfield (internal) | AI Employees = skills + memory; spend approval | squads as named employees; price before render | face and recreate features |
| VideoDB Director (MIT) | open-source video agent framework, 20+ agents, typed outputs | typed outputs per squad | a Python agent runtime |
| ReelFarm, SlideStorm, SlidesTok | TikTok slideshow tools, $19–99/month; SlidesTok: landing URL → slides | demand is real; URL → slides is what our onboarding documents hold | posting farms, many accounts |
| TikTok Content Posting API | photo posts: up to 35 images, cover index, `auto_add_music`; unaudited apps post privately | slideshow outputs a PNG set as well as MP4 | — |
| Opus remakes + Claude Design (report 2026-10-22) | spec with numbers + render → look → fix loop | the look check in every squad | — |

## 5. Design: one adapter, seven squads, shared tools

Every squad has the long take's shape: LLM step → code reviewer (sends back once) → builder (ops) → renderer.

- **Callers:** brain (work order + brief, through the order runner `lib/cmo/jobs/studio-orders.ts`), founder in the
  editor (chat, buttons, slash commands), MCP (founder's Claude with its own plans).
- **Studio adapter** (`lib/departments/studio/adapter.ts`): plan → card → decide (brain cards go to the Approval
  inbox); every call under the founder's RLS session (a brain order mints a short-lived user JWT as MCP does); the
  order holds an allowance before its team calls a model (`studio_order_hold`); writes a deliverable with a status.
- **Squads:** Long take, Intro, Explainer, B-roll + image, Shorts, Slideshow, Post image.
- **Shared:** `editor-core` ops (only write path, Version history per write); generation (credit hold, spec hash,
  `credit_orders` for one-card jobs); moderation (Creem on the prompt before credits; Haiku vision + fal NSFW on the
  image or 3 frames after); `render_document` (one export per timeline); look check.
- **Inputs:** marketing documents and Brand Kit; media library and uploads; transcripts (Scribe words, voice-over word
  timings); captured pages; style skills.
- **Outputs:** deliverables `kind = video | short | slideshow | image`, cards in the Approval inbox, approved →
  Schedule. Editing the founder's own video produces a deliverable only when the founder marks the edit finished.

## 5b. Charge before running in Studio

Owner rule (2026-11-05): a paid job shows one card with one price that covers everything, the founder confirms once,
and the job runs to the end.

- **`/video`, one card** (phase 4, `c9a4f40`). The storyboard card prices the whole video (keyframes, shots,
  voice-over, music). Approving opens one job (`credit_order_open`, `kind = long_take`); every piece starts at once and
  draws its price from the job (`credit_order_draw`); a shot names the keyframes it waits for with `startAfter` /
  `endAfter` (`20270109030000_keyframe_chaining.sql`), and a failed keyframe fails and refunds the shots that wait on
  it. The one-go cap (`generation_active_limit`, `20270109040000`) guards load, not money. The job closes when the
  scene is placed, and the reaper closes one left open for a day.
- **Explainers: `plan_explainer` → `preview_explainer` → `add_explainer`** (`lib/agent/explainer-tool.ts`).
  `plan_explainer` shows the storyboard (say, label, picture per beat), the direction and one price before any code is
  written: the render, plus writing and checking the animation, billed as used up to `agent_3d_hold_credits()`.
  Approving holds the render price in one job (`kind = explainer`, tied to its clip and turn by `subject`).
  `preview_explainer` renders stills of the scene code and a layout report, so the model looks at its own work and
  fixes the worst problem; it runs only after the plan was approved. `add_explainer` saves the previewed code,
  starts the render from the approved job (no second card) and places one video layer; the voice is made inside the
  render job. Since #180 the Assistant re-plans in every turn, fixes the preview's issues and ends with the voice.
- **Studio order hold** (`20270109050000_studio_order_hold.sql`). A brain order holds `studio_plan_hold()` (5 credits)
  before the Director, the clip editor or the slides writer is called; usage is charged against it and the rest comes
  back when the order ends. Short of it the order fails as `needs_credits` and no model runs. The media of a brain
  video are held by their own job, confirmed on the storyboard card (`kind = studio_video`).
- **Review fixes** (`20270110010000_review_fixes.sql`): `create_generation` takes the credit owner's lock before a
  shot's keyframe rows (a keyframe finishing while its shot was created could deadlock); an explainer job draws only
  for its own clip and turn; an explainer turn's tokens are capped at `agent_3d_hold_credits()`.

## 6. Shorts squad

Only from an edit the founder marked finished, in the founder's own project. No generation credits.

Chain: Segmenter (code) → Clip editor (LLM, agent `shorts`) → Clip reviewer (code) → Builder (`make_short`) →
Renderer (`renderShort`) → look check. Built in `lib/departments/studio/shorts/` (`squad.ts`, `cut.ts`).

| Step | What it does |
|---|---|
| Words with times | Scribe words of the founder's video, or the voice-over word timings and beats of an AI video |
| Segmenter (code) | sentence ends and pauses give the candidates; every range comes from here, never from the model |
| Clip editor (LLM) | picks 3 (the default) of up to 8 candidates by id and writes hook, title and reason; one cheap call |
| Clip reviewer (code) | starts and ends on a whole sentence (no name or number split); 15–60 s; the hook inside the first 3 s; no overlap; sends back once |
| Builder (`make_short`) | copies the timeline, sets the workarea, frames 9:16 (face framing when the engine has it) |
| Renderer + look check | one `render_document` per short; frames of the full-size file checked before the card |
| Card | one `shorts_batch` card for all shorts of a video; approved shorts get captions and go to Schedule |

## 7. Slideshow squad

A slideshow is a document of timed slides: same ops, renderer, export; no new runtime. Owner decision 2026-10-26: one
editor core with a Slides view, not a second editor.

Chain: Slides writer (`write_slides`, agent `slides_writer`) → Builder (slide ops) → Renderer → look check.

- Inputs: brief from the week plan, marketing documents, Brand Kit, captured pages of the founder's own site.
- Writer: 5–10 slides; slide 1 is the hook; one idea per slide; the last slide is a call to action; no-ai-slop in the
  prompt.
- Visuals: the founder's screenshots and captured pages first; an AI image only when needed, moderated, never with
  text inside the image. Text is always an editor layer.
- Outputs from one document: **MP4** (timed slides) through `render_document` and a **PNG set** (one still per slide)
  through `render_stills`; one `slideshow` card for both, with quick text edits per slide and "Open in Slides".
- Editor: a project of kind `slideshow`; the Slides view (`components/editor/slides`) with the slide ops of
  `editor-core/src/ops/slides.ts`, so the Assistant and MCP get them too.

## 8. Post image squad

For a post that needs a picture, a video cover or a YouTube thumbnail. A frame of the founder's video or a captured
page with a title layer, Brand Kit fonts and colours, one still (`build_post_image`). It makes a one-slide edit in the
job of the video it takes a frame from, and writes an `image` deliverable linked to its post (`deliverables.post_id`);
it has no card of its own, the post's card shows the image. Built and tested in the acceptance runs, but nothing
creates the order yet.

## 9. Quality gates

| Gate | Where | State |
|---|---|---|
| Moderation | Creem's Moderation API on the prompt before credits (`lib/generate/moderation.ts`, again in `opencmo/ai/moderation.py`); Haiku vision + fal NSFW on the image or 3 video frames, against `packages/contracts/creem-policy.json` | ✅ |
| Garbled text on keyframes | the long take's text check | ✅ |
| No double payment | spec hash, request id, `credit_orders` | ✅ |
| Look check | worker task `look_check` on the full-size export, before any card: ffmpeg finds black, frozen and silent stretches; a Claude vision judge (`look_judge.py`) answers two fixed questions on up to 12 frames (captions inside the frame, text readable). A failure goes back to the squad once (`sent_back`), then to the card with a note; the judge is a hint, never a gate | ✅ |
| Brand fit | fonts, colours, logo from the Brand Kit | ✅ `apply_brand_kit` |

## 10. Evals

| Squad | Measure |
|---|---|
| Long take | frames of the acceptance video: frozen shots, jumps at shot boundaries, garbled text; credits and wall time per 60 s |
| Shorts | approved as is; code-check pass rate (whole sentences, length); views per short from `post_metrics` |
| Slideshow | approved as is; text fits on every slide; time from brief to card |
| All | look check pass rate; credits per approved deliverable; the Assistant's 42 eval tasks stay green |

## 11. Build phases

All built: **S0** the long take · **S1** the Studio adapter, the finished state, named-timeline export · **S2** the
Shorts squad · **S3** the Slideshow and Post image squads · **S4** the look check and Studio evals. Charge before
running reached Studio in phases 2–6 of the 2026-11-06 plan (§5b).

What is left, ranked by the CMO loop (owner, 2026-11-08): hide `/video` (plan S2.4) and remove its leftovers (S2.8); a
caller for the post image squad; then, in the editor's own plans, the long take's release and showing `/video` again.

**History.** Until 2026-11-08 Studio was ranked by the editor strategy ("Shorts first, every OpenCMO video becomes 3
shorts, then Slideshow, then Post image"), and the long take used two cards (storyboard, then a contact sheet with the
exact price). The contact sheet was removed on 2026-11-06.

## 12. Decisions for the owner

| # | Question | Decision |
|---|---|---|
| 1 | Shorts from the founder's own finished edits too? | **decided 2026-10-26: both**; the source is always a finished edit in the founder's project |
| 2 | Shorts per video by default | **decided: 3** |
| 3 | Approve one by one or as a batch? | **decided: as a batch**, one card |
| 4 | Name in code `short` instead of `clip`? | **decided: `short`** |
| 5 | Slideshow outputs MP4 and PNG set? | **built**: both from one document |
| — | Slideshow inside the editor or a separate page? | **decided**: one editor core, a Slides view |
| 6 | Look check on every render or only before a card? | **built**: only before a card |
| 7 | `/video` | **decided 2026-11-08: hide it** in the web app, the landing page and the week plan (plan S2.4–S2.5); the code, MCP tool and evals stay |

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
