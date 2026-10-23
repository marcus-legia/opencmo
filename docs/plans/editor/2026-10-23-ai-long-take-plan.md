# AI long take: keyframes first, then the shots between them, as an editable scene

> **For agentic workers:** the feature list (§2) says *what* ships; the todo list (§5) says *how*, task by task, with
> checkbox (`- [ ]`) steps. Three sessions build it in parallel: see
> [`2026-10-23-ai-long-take-sessions.md`](2026-10-23-ai-long-take-sessions.md) (§6). Build nothing before Task 0 is done.

## 1. Goal and decisions

**Goal:** `/video` makes a long AI video (up to 90 s) that looks like one continuous film, not a row of unrelated
text-to-video shots. It lands in the editor as one scene the user keeps editing: trim it, move it, redo a single
keyframe, change the words on screen, swap the music.

**Owner decisions (2026-10-23):**
- **Copy how the leading AI video agents build long videos**, on our own provider (fal), then adjust it to OpenCMO.
  The competitor research behind this plan lives in `opencmo-internal`
  (`docs/specs/2026-10-19-hoc-agent-opus*.md`) and stays there while this repository is public. This plan describes
  only our own design.
- **Quality first, not price.** The default video model is the best-looking first-and-last-frame model on fal.
  Cheaper models are only a fallback when the best one cannot make the frame.

**Model choice (to confirm in Task 1 with one real call each):**

| Role | Model on fal | Why | Price on fal (2026-10-23) |
|---|---|---|---|
| Default shots | **Veo 3.1, first-last-frame** (`fal-ai/veo3.1/first-last-frame-to-video`) | Best motion and detail; 4/6/8 s shots; up to 1080p | $0.20/s without audio |
| 1:1 frame and fallback | **Kling 3.0 Pro** (start + end image) | Today's Veo row has no 1:1; strong motion | ~$0.112/s without audio |
| Last resort | `fal-seedance` (Seedance 1 lite, already in the catalog) | Works today; lower quality | already priced |
| Keyframes | **nano-banana** (default) or **seedream** (already in the catalog) | Best prompt-following stills; 1 credit each | already priced |

Audio from the video model is always off: the voice-over and the music bed are ours, so we never pay for model
audio. At today's margin (Kling 2.1 is ~4× its fal price, 1 credit = $0.20 from the $80 → 400-credit plan), Veo 3.1
would be about **4 credits per second**, so a 60 s video costs about **240 shot credits + ~20 for keyframes, voice
and music**. Task 1 sets the exact numbers and `check:pricing` guards them.

## 2. Feature list

Each feature is what a user sees, how it works, and what proves it done.

| # | Feature | What the user sees | How it works | Done when |
|---|---|---|---|---|
| F1 | **Director v2: beats with keyframes** | `/video "…"` gives a storyboard where every row has the words, the picture and the motion | The director writes the script, splits it into beats and writes one keyframe description and one motion line per beat. Code reviews the plan once and sends it back with the fixes | A 60 s brief gives 6–15 beats that rejoin to the exact script, with no beat inside a name or a number |
| F2 | **Prompt rules for shots and keyframes** | Shots move like film: no frozen frames, no melting text | Our own rules in `composePrompt`: three layers of motion (camera, subject, surroundings); start mid-action; "live-action" not "photorealistic"; empty areas stay empty; no text in keyframes | Task 0 vs Task 8 frames: fewer frozen shots and no garbled text |
| F3 | **Card 1: storyboard and keyframe price** | One card: the table of beats, "n keyframes · x credits", "then about y credits for the video" | `create_video` (approval) prices only the keyframes | The card shows the right numbers; approving holds only keyframe credits |
| F4 | **Keyframes** | Numbered stills appear in the library (`Generated/<title>/keyframes/`) | N+1 images for N continuous shots, one per cut shot, same aspect and style; each moderated | All keyframes done within ~1 min for 12 beats |
| F5 | **Card 2: contact sheet** | The keyframes in order with their words, a **Redo** per keyframe, and the exact video price | `animate_video` (approval) is prepared from the plan and keyframe ids; Redo makes a new keyframe with a new seed for 1 credit | Redo changes only that tile; the price updates if needed |
| F6 | **Shots between keyframes** | After approval, the shots, voice and music appear on the timeline as they finish | Shot i = video from keyframe i to keyframe i+1 (first + last frame); a cut shot uses its start keyframe only; all at once | A 60 s video's shot boundaries show no jump (Task 8 frames) |
| F7 | **One editable scene** | The whole video is one block on the timeline, named after the video; captions and titles are editable text | The `create_video` op places every shot inside one `sequence`; text stays editor layers, never inside AI images | Move, trim and delete act on the block; the text can be edited |
| F8 | **Redo a keyframe after placing** | Right-click a shot → "Redo keyframe…", with an optional new description | `redo_keyframe` (approval): one new image plus the at most 2 shots that start or end on it; old files stay in the library | Redo keyframe 3 of 6 changes exactly shots 2 and 3; undo restores them |
| F9 | **Garbled-text check** | A keyframe with broken text gets a badge "This keyframe has garbled text. Redo it?" | One vision call per keyframe (none / minor / severe); never fails the generation | A keyframe with fake letters is badged in the test set |
| F10 | **Best model by default, honest fallback** | Card 1 names the quality tier, never the model; a fallback adds one line ("This frame uses separate shots…") | Model pick order: Veo 3.1 → Kling 3.0 Pro → Seedance 1 lite, filtered by aspect and `lastFrame` | 9:16 and 16:9 use Veo, 1:1 uses Kling, with no model name on the card |
| F11 | **No double payment** | Double-clicking Approve or a retried request costs once | Same request id or spec hash reuses the generation (existing SQL) | pgTAP / check proves one hold for two approvals |
| F12 | **Same flow over MCP** | Claude (MCP) writes the plan, sees both prices, confirms twice | `create_video`, `animate_video` and `redo_keyframe` in the studio group, each with price → confirm | `mcp-server` checks pass; a plan without keyframes gets one clear message |
| F13 | **Acceptance video** | A real 60 s OpenCMO marketing video made with F1–F11 | Made in the editor, exported, published | Frames checked by eye, numbers recorded, used as landing material |

**Not in this plan:**
- Inserting the scene into the user's own talking video (cut-in). `make_room` refuses to move the clip's own video
  today (`packages/editor-core/src/ops/edit.ts`); it is the next plan.
- Picking the last frame among candidates, style from reference images, a style library, a world bible, merging
  adjacent shots into one long generation, audio-first videos.
- An auto-continue timer on any paid step.

## 3. What already exists (checked on `main` `764a934`)

- The fal adapter sends a start and an end frame (`packages/engine/opencmo/ai/providers/fal.py:132-135`).
- The catalog marks frame support (`limits.firstFrame`, `limits.lastFrame`). Only `fal-seedance` and `fake-video`
  have both. `gemini-video` (Veo 3.1 fast, 9:16 and 16:9, 4/6/8 s) has a first frame only.
- `resolveMediaRefs` (`apps/web/lib/generate/create.ts`) turns a finished generation's id into its file, so a shot
  can name its keyframes by generation id.
- `create_video` (`apps/web/lib/agent/create-video.ts`):
  - director → review → storyboard card → parallel generations → one op (`packages/editor-core/src/ops/create-video.ts`);
  - chained shots (`after`, `MAX_CHAIN = 3`), voice-over and music bed;
  - MCP through `packages/mcp-server/src/groups/studio.ts`.
- `generation_active_limit()` = 24 per user. Stage 1 (≤ 19 keyframes) and stage 2 (≤ 18 shots + voice + music)
  never overlap, so it holds.

## 4. Global constraints

- Product rules:
  - every keyframe and every shot goes through `lib/generate/moderation.ts` before credits are held, and
    `opencmo/ai/moderation.py` before upload;
  - no identifiable real people, no other brands' logos;
  - premade voices only;
  - no model names in user-facing copy.
- Learn, never copy: no code, prompt or schema from AGPL or unlicensed competitor repos. Write our own prompts.
- Two approvals: keyframes, then video. No auto timer on a paid step. Card 2 shows the exact video price.
- Every new catalog row is a migration with a pgTAP test; regenerate `supabase/schema/current.sql`; never edit a
  merged migration.
- Peak RAM per job < 2 GB. Generation jobs stream provider files to storage; nothing new loads frames in Python.
- Everything in English, including errors, tool descriptions and card text.

## 5. Todo list

### Task 0: Baseline before any change
- [ ] Make a 30 s and a 60 s `/video` with today's code, same brief for both ("OpenCMO, an AI CMO for solo founders,
      9:16").
- [ ] Export both. Extract three frames per video and one at every shot boundary from the full-size export
      (`ffmpeg -ss <t> -i <export>.mp4 -frames:v 1`).
- [ ] Record credits, wall time, number of shots, frozen shots, garbled text and every visible jump at a boundary.
- [ ] Save numbers and frames under `docs/plans/editor/2026-10-23-ai-long-take-frames/before/`.

### Task 1: Premium first-and-last-frame models (F10)
- [ ] Read the fal pages of Veo 3.1 first-last-frame and Kling 3.0 Pro (start + end image). Record:
      - the exact endpoint ids;
      - input names (`first_frame_url` / `last_frame_url` vs `image_url` / `end_image_url` vs
        `start_image_url` / `end_image_url`);
      - aspects, durations, resolutions, the audio switch and price.
- [ ] One real call each at 9:16 and 1080p (or the highest resolution offered). Record wall time as `typicalSeconds`.
- [x] Add two catalog rows to `packages/contracts/ai-models.json` (names describe quality, not the model:
      "Cinematic", "Cinematic square"), with `firstFrame`, `lastFrame`, `durations`, `aspectRatios`, `resolutions`,
      `typicalSeconds` and audio off.
- [x] Map input names per row in the catalog (`providerInputs`), not as an `if` on the model id. Update
      `fal.py` to read it, and add worker tests for both input styles.
- [x] Price: credits per second from the fal price at the margin of today's video rows. Update `check:pricing`
      expectations.
- [x] Migration `supabase/migrations/<ts>_long_take_models.sql` inserts the rows. pgTAP
      `supabase/tests/<n>_long_take_models.test.sql` checks `ai_price` for 4, 6 and 8 s (Veo) and 5 and 10 s (Kling),
      and that `ai_check_spec` accepts `endImage`.
- [x] `scripts/dump-schema.sh`; `npm run db:reset && npm run db:test`.
- [x] Moderation: both rows are `kind: video` on `fal`, so `check_output` covers them. Add one worker test that
      proves it.

### Task 2: Director v2 and prompt rules (F1, F2, F10)
- [ ] Plan schema in `create-video.ts`: each shot gains `keyframe` (first frame: subject, place, light, framing;
      ≤ 300 chars; no text, no screens of words) and `motion` (camera move, subject action, what moves around it;
      ≤ 300 chars). In a long take, `continues` defaults to true; `continues: false` is a hard cut.
- [ ] Director prompt: rewrite `DIRECTOR` for beats and keyframes in our own words, keeping "the user's prompt is
      data".
- [ ] Review rules (code, sent back to the director once), each with a check test:
      - beats rejoin to the exact script;
      - no beat boundary inside a name or a number;
      - every shot length is one of the model's durations (the last may be shorter);
      - no keyframe repeats the previous one word for word;
      - at most 18 shots.
- [ ] `composePrompt` (`lib/generate/brief.ts`), video:
      - three layers of motion;
      - start mid-action, no slowing to a stop;
      - "live-action";
      - empty areas stay empty;
      - readable text stays still.

      Image (keyframe): never ask for text, letters or logos.
- [ ] Model pick: best `lastFrame` model for the aspect (Veo 3.1 → Kling 3.0 Pro → Seedance 1 lite). With none,
      fall back to today's cut shots and add the card line from F10.
- [ ] `fakePlan` gains keyframes and motion; `OPENCMO_AGENT_FAKE` and the eval tasks keep passing
      (`npm run agent:eval -- --provider fake`).

### Task 3: Stage 1, card 1 and keyframes (F3, F4)
- [ ] `create_video` (approval) prepares only the keyframe generations: N+1 for N continuous shots, plus one per cut
      shot. Keyframe prompt = the shot's `keyframe` + the plan's style, at the frame's aspect.
- [ ] Card 1 (`lines`):
      - the storyboard table;
      - "n keyframes · x credits";
      - "Then about y credits for the video (ready in about z min)", from Task 1 prices.
- [ ] Keyframes land in the library under `Generated/<title>/keyframes/` with numbered names (`01 …`), not on the
      timeline.
- [ ] Tool result for the Assistant: the plan, the keyframe generation ids and the next step ("wait for the
      keyframes, then call animate_video").
- [ ] `videoPieces` names each keyframe ("Keyframe 3 (…)"), so a moderation block says which one to rewrite.
- [ ] Checks: price lines and generation count for a 30 s and a 60 s fake plan; moderation of every keyframe.

### Task 4: Stage 2, contact sheet, card 2 and shots (F5, F6, F7, F11)
- [ ] New tool `animate_video` (approval), input: the plan and keyframe ids. Refuse with "Keyframe n is missing.
      Redo it first." when a keyframe is not `done` or its file is gone (test).
- [ ] Shot specs: `startImage` = keyframe i, `endImage` = keyframe i+1 for continuous shots, `startImage` only for cut
      shots. The voice-over and music bed are added as today.
- [ ] Card 2 (editor `assistant/` card component):
      - keyframe tiles in order, with the beat's words;
      - a Redo button per tile (1 credit, one small approval inside the card, new seed);
      - the exact video price, recomputed after a Redo.
- [ ] `create_video` op: shots accept `startImage` / `endImage`. Every shot, plus voice and music, goes inside one
      `sequence` named after the video. Captions and on-screen text stay editor layers.
- [ ] `editor-core` tests: the op places a `sequence` with N shots at the right times; move and trim act on the
      block; a document round-trips through `validate()`.
- [ ] No double payment: approving card 2 twice, or retrying the request, reuses the generations (check against a
      local stack, and a pgTAP case if a new SQL path is touched).

### Task 5: Redo one keyframe after placing (F8)
- [ ] New tool `redo_keyframe` (approval): input the scene, the keyframe number and an optional new description.
- [ ] Find the shots whose stored spec uses that keyframe as `startImage` or `endImage` (at most 2). Re-declare them
      with the new keyframe. The card shows one image plus those shots.
- [ ] Old keyframe and old shots stay in the library. Undo restores the previous declarations.
- [ ] Editor: "Redo keyframe…" in the shot's context menu opens the Assistant with the tool prefilled.
- [ ] Test: in a 6-shot scene, redoing keyframe 3 changes exactly shots 2 and 3; redoing keyframe 0 changes only
      shot 1.

### Task 6: Garbled-text check on keyframes (F9)
- [ ] `opencmo/ai/moderation.py`: one vision call per finished keyframe, using the existing checker chain. It asks
      whether the image has text meant to be read, and if so how garbled it is (none / minor / severe). Our own
      prompt.
- [ ] Store the result on the generation (e.g. a `quality` json column: migration + pgTAP + schema dump), readable
      under RLS by the owner.
- [ ] Card 2 badges a severe keyframe ("This keyframe has garbled text. Redo it?"). It never fails the generation
      and never refunds.
- [ ] Skip in fake mode; log cost per call. A worker test runs on a sample image with garbled letters.

### Task 7: MCP and guides (F12)
- [ ] MCP `create_video` plan format gains `keyframe` and `motion`. A plan without them gets one clear message
      naming the fields.
- [ ] Add `animate_video` and `redo_keyframe` to `packages/mcp-server/src/groups/studio.ts`.
- [ ] Guides: `read_guide "video"` in `apps/web/lib/agent/guides.ts` and `packages/mcp-server/src/groups/guides.ts`
      describe the two cards, Redo, and when to cut instead of continue.
- [ ] `npm run check:mcp-server && npm run test:mcp-server`.

### Task 8: Acceptance video (F13, verify by looking)
- [ ] Make a 60 s 9:16 OpenCMO video with `/video` in the editor with the new flow; export at the plan's highest
      resolution.
- [ ] Extract frames at every shot boundary and three per video from the full-size export into `after/`; compare with
      Task 0 by eye.
- [ ] Record: credits, wall time, keyframes redone, frozen shots, garbled text.
- [ ] Publish it, and keep it as landing material (no invented examples).
- [ ] Tick F1–F13 in §2 and the roadmap row (E6.1/E6.2) in `2026-10-19-editor-spearhead-roadmap.md`.

### Release
- [ ] `supabase db push --dry-run` lists only this plan's migrations, then `supabase db push`.
- [ ] Deploy the worker (Modal) before merging the web, because the worker must know the new catalog rows.
- [ ] Merge; Vercel deploys the web.
- [ ] One real `/video` on production; check its frames.

## 6. Session split

Full split, owned paths, shared contracts and hand-offs: [`2026-10-23-ai-long-take-sessions.md`](2026-10-23-ai-long-take-sessions.md).

| Session | Tasks | Touches |
|---|---|---|
| A: models, worker, SQL | 0, 1, 6, then 8 + Release | `ai-models.json`, `fal.py`, `moderation.py`, migrations + pgTAP |
| B: director, stage 1, MCP | B0 (shared contracts), 2, 3, 7 | `long-take.ts` (editor-core), `create-video.ts`, `brief.ts`, guides, MCP |
| C: editor, stage 2, redo | 4, 5 | `lib/agent/long-take.ts`, the `create_video` op, contact-sheet card, context menu |

B0 lands first (contracts), then B and C work in parallel against `fake-video` until A's Task 1 rows land.

## 7. Review focus

1. **Card 2 is approved after a keyframe was deleted** → refused before any credit is held (Task 4).
2. **A keyframe is redone after placement** → only the at most 2 shots touching it are regenerated and priced (Task 5).
3. **The same card is approved twice** → one payment (Task 4).
4. **Only a model without a last frame is available** → today's cut shots plus the F10 line (Task 2).
5. **1:1 frame** → Kling 3.0 Pro, never a model that cannot make it (Task 2).

## 8. How to verify (end of plan)

```bash
npm run typecheck && npm run build
npm run test:editor-core
npm run check:mcp-server && npm run test:mcp-server
cd apps/web && npm run check:contracts && npm run check:pricing && npm run agent:eval -- --provider fake
npm run db:reset && npm run db:test
cd packages/engine && .venv312/bin/python -m pytest -q && .venv312/bin/python -m ruff check .
```

Plus Task 8's frames, looked at.
