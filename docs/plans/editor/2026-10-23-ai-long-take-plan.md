# AI long take: keyframes first, then the shots between them, as an editable scene

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. Two sessions can build it in parallel; the split is
> at the end. Build nothing before Task 0 is done.

**Goal:** `/video` makes a long AI video (up to 90 s) that looks like one continuous film instead of a row of
unrelated text-to-video shots. It lands in the editor as a scene the user can keep editing: trim it, move it, redo a
single keyframe, or insert it into a video of their own later.

**Owner decision (2026-10-23):** copy how the leading AI video agents build long videos, on our own provider (fal),
then adjust it to OpenCMO. Competitor research behind this plan lives in `opencmo-internal`
(`docs/specs/2026-10-19-hoc-agent-opus*.md`); it stays there while this repository is public. This plan describes
only our own design.

**Architecture:** keep `create_video` (`apps/web/lib/agent/create-video.ts`, op in
`packages/editor-core/src/ops/create-video.ts`) and change what sits between the storyboard and the shots:

```
brief ──► director: script, beats, one keyframe description per beat     (no cost)
      ──► card 1: storyboard + keyframe price                             approve
      ──► keyframe images, one per beat boundary                          cheap (image model)
      ──► card 2: contact sheet of keyframes + video price                approve, or redo a keyframe first
      ──► shot i = video from keyframe i to keyframe i+1 (first + last frame)
          + voice-over + music, all at once                               the paid part
      ──► one `sequence` named after the video, on the timeline
```

Text never goes into a generated image: titles and captions stay editor text layers, so they never come out garbled.

**What already exists (checked on `main` 2026-10-23):**
- The fal adapter sends a start and an end frame (`packages/engine/opencmo/ai/providers/fal.py:132-135`).
- The catalog marks models that take them (`limits.firstFrame`, `limits.lastFrame`); today only `fal-seedance`
  (Seedance 1 lite) has both.
- `resolveMediaRefs` (`apps/web/lib/generate/create.ts`) turns a finished generation's id into its file, so a shot
  can name its keyframes by generation id.
- The Director → review → storyboard card → parallel generations → one op flow, chained shots (`after`), the voice
  and the music bed, and MCP access through `packages/mcp-server/src/groups/studio.ts`.

**Tech stack:** TypeScript (Next.js, editor-core, zod 4, vitest, `tsx` checks), Python worker (pytest), Supabase SQL
+ pgTAP for the catalog rows.

## Global constraints

- Product rules hold: every keyframe and every shot goes through `lib/generate/moderation.ts` before credits are held
  and `opencmo/ai/moderation.py` before upload. No identifiable real people, no other brands' logos, premade voices
  only, no model names in user-facing copy.
- Learn, never copy: no code, prompt or schema from AGPL or unlicensed competitor repos. Write our own prompts.
- Two approvals, never one: keyframes are cheap, video is not. Card 2 shows the exact video price. There is no auto
  timer on a paid step.
- One user may have 24 generations in flight (`generation_active_limit()`). Stage 1 (≤ 19 keyframes) and stage 2
  (≤ 18 shots + voice + music) never overlap, so the limit holds.
- Every new catalog row is a migration with a pgTAP test; regenerate `supabase/schema/current.sql`.
- Peak RAM per job < 2 GB. Generation jobs stream provider files to storage; nothing new loads frames in Python.
- Everything in English, including errors, tool descriptions and card text.

## Review focus

1. **Card 2 is approved after a keyframe was deleted from the library** → stage 2 refuses with "Keyframe n is
   missing. Redo it first." before any credit is held. Test in Task 4.
2. **A keyframe is redone after the shots were placed** → only the shots that start or end on it (at most 2) are
   regenerated and priced; the others keep their files. Test in Task 5.
3. **The same card is approved twice** (double click, retried request) → no second payment: the same request id or
   spec hash reuses the generation. Test in Task 4.
4. **A model without a last frame is the only one available** → `/video` falls back to today's cut shots and says so
   on card 1. Test in Task 2.

---

## Task 0: Baseline before any change

- [ ] Make a 30 s and a 60 s `/video` on production (or locally with real keys) with today's code. Same brief for
      both: "OpenCMO, an AI CMO for solo founders, 9:16".
- [ ] Record: credits, wall time, number of shots, and three frames per video from the full-size export
      (`ffmpeg -ss <t> -i <export>.mp4 -frames:v 1`). Note every visible cut that breaks continuity.
- [ ] Save the numbers and frames under `docs/plans/editor/2026-10-23-ai-long-take-frames/before/`.

## Task 1: Models that take a first and a last frame (catalog + SQL)

Files: `packages/contracts/ai-models.json`, new migration `supabase/migrations/2026MMDD_long_take_models.sql`,
`supabase/tests/<n>_long_take_models.test.sql`, `apps/web/lib/pricing*` (`check:pricing`).

- [ ] Check on fal which video endpoints take both frames at our aspects (9:16, 16:9, 1:1) and lengths. Candidates
      found 2026-10-23: Veo 3.1 `fal-ai/veo3.1/first-last-frame-to-video` (4/6/8 s, $0.20/s without audio), a newer
      Seedance with `image_url` + `end_image_url`, Kling 3.0 Pro with `start_image_url` + `end_image_url` (~$0.112/s).
      Read each model's fal page; record the exact endpoint id, input names, durations and price.
- [ ] Add up to two rows (one cheap default, one premium), with `firstFrame`, `lastFrame`, `durations`,
      `aspectRatios`, `typicalSeconds` measured on one real call. Keep `fal-seedance` as the fallback.
- [ ] If an endpoint names its inputs differently from `image_url` / `end_image_url`, map them in `fal.py` per model
      (a `providerInputs` entry in the catalog, not an `if` on the model id), with a worker test.
- [ ] Credits per second from the fal price with the same margin as today's video rows; `npm run check:pricing`
      passes.
- [ ] Migration inserts the rows; pgTAP checks `ai_price` for a 5 s and a 10 s shot of each.

## Task 2: Director v2 (beats with keyframes) and prompt rules

Files: `apps/web/lib/agent/create-video.ts`, `apps/web/lib/generate/brief.ts`, `apps/web/lib/agent/guides.ts`,
`packages/mcp-server/src/groups/guides.ts`, tests in `apps/web/lib/agent/*.check.ts`.

- [ ] Plan schema: each shot gets `keyframe` (what the first frame shows: subject, place, light, framing, at most
      300 chars, no text, no screens of words) and `motion` (camera move, what the subject does, what moves around
      it). `continues` defaults to true in a long take; a shot with `continues: false` is a hard cut and starts from
      its own keyframe only.
- [ ] Review rules (code, sent back to the director once, like today):
      - the script is split into beats that rejoin to the exact script, never inside a name or a number;
      - every shot length is one of the model's durations (the last may be shorter);
      - no shot keyframe repeats the previous one word for word.
- [ ] Prompt rules in `composePrompt` for video (our own words):
      - three layers of motion per shot (camera, subject, surroundings);
      - start mid-action, never slow to a stop at the end;
      - "live-action" instead of "photorealistic";
      - empty areas stay empty;
      - any readable text stays still.

      For keyframe images: never ask for text.
- [ ] Pick the model: a `lastFrame` video model for the frame, else fall back to today's cut shots, with the line
      "This video uses separate shots: no model here can join two frames." on card 1.
- [ ] Fake director (`fakePlan`) gains keyframes and motion so tests and `OPENCMO_AGENT_FAKE` keep working.

## Task 3: Stage 1, keyframes and card 1

Files: `apps/web/lib/agent/create-video.ts`, `apps/web/lib/agent/screen-pieces.ts`,
`apps/web/components/editor/assistant/*` (card), `apps/web/lib/agent/tools.ts`.

- [ ] `create_video` (approval) now prices and creates only the keyframes: N+1 images for N continuous shots (one
      per boundary), one per cut shot. Same image model and aspect as the frame; the keyframe prompt is the shot's
      `keyframe` plus the plan's style.
- [ ] Keyframes land in the library under `Generated/<title>/keyframes/` (numbered), not on the timeline.
- [ ] The tool's result tells the Assistant the next step: wait for the keyframes, then call `animate_video`. The
      result holds the plan and the keyframe generation ids.
- [ ] Card 1 lines: storyboard table (as today), "n keyframes · x credits", and "Then about y credits for the video"
      (estimate from Task 1 prices).

## Task 4: Stage 2, the contact sheet, card 2 and the shots

Files: `apps/web/lib/agent/create-video.ts` (new `animate_video` tool), `packages/editor-core/src/ops/create-video.ts`,
editor card component, `packages/mcp-server/src/groups/studio.ts`.

- [ ] `animate_video` (approval) takes the plan and the keyframe ids. It refuses if any keyframe is not `done` or its
      file is gone (Review focus 1). Shot i spec: `startImage` = keyframe i, `endImage` = keyframe i+1 for a
      continuous shot. It also creates the voice-over and the music bed, as today.
- [ ] Card 2 is a contact sheet: the keyframes in order with the beat's words under each, a "Redo" button per
      keyframe (a new seed, ~1 credit, no second approval of the whole card), and the exact video price.
- [ ] The `create_video` op accepts `startImage` / `endImage` in shot declarations and places all shots inside one
      `sequence` named after the video, so the scene moves and trims as one block. Captions and on-screen text stay
      outside the generated images.
- [ ] Double approval and retries reuse generations by request id and spec hash (Review focus 3).

## Task 5: Redo one keyframe after the scene is placed

Files: new agent tool `redo_keyframe` (approval), `packages/editor-core/src/ops/*` (re-declare shots),
editor context menu on a shot.

- [ ] Input: the scene and the keyframe number, plus an optional new description. The new keyframe is a new
      generation. The shots whose spec names the old keyframe as start or end (at most 2) are re-declared with it.
- [ ] Price on the card: one image plus those shots only. The old shots stay in the library (an edit branches, never
      overwrites), so undo brings them back.
- [ ] Test: a 6-shot scene, redo keyframe 3 → exactly shots 2 and 3 change (Review focus 2).

## Task 6: Catch garbled text in keyframes

Files: `packages/engine/opencmo/ai/moderation.py` (reuse its frame sampling), worker generate task, card 2.

- [ ] After a keyframe image is made, one vision call asks whether the image contains text that was meant to be
      read, and whether it is garbled (none / minor / severe).
- [ ] A severe result never fails the generation. It marks the keyframe on the contact sheet ("This keyframe has
      garbled text. Redo it?"), because a redo is cheap.
- [ ] Cost per call is logged; skip it in fake mode.

## Task 7: MCP and guides

- [ ] MCP `create_video` plan format gains `keyframe` and `motion`; add `animate_video` and `redo_keyframe` to the
      studio group with the same two-step price → confirm flow.
- [ ] Guides (`read_guide "video"`) describe the two cards and when to redo a keyframe.
- [ ] `mcp-server` checks: a plan without `keyframe` gets one clear message naming the field.

## Task 8: The acceptance video (verify by looking)

- [ ] Make a 60 s 9:16 OpenCMO video with `/video` in the editor, end to end, with the new flow; export it.
- [ ] Save frames from the full-size export at every shot boundary next to Task 0's frames under `after/`;
      check by eye that boundaries do not jump.
- [ ] Record: credits, wall time, how many keyframes were redone. Publish it as real landing material.

---

## Session split

| Session | Tasks | Touches |
|---|---|---|
| A (worker + catalog) | 0, 1, 6 | `ai-models.json`, migration + pgTAP, `fal.py`, `moderation.py` |
| B (agent + editor) | 2, 3, 4, 5, 7 | `create-video.ts`, `brief.ts`, editor-core op, cards, MCP |
| Both | 8 | — |

Task 1's catalog rows land first: Session B codes against `limits.lastFrame` and can use `fake-video` (which has both
frames) until then.

## Not in this plan

- Inserting the scene in the middle of the user's own talking video (cut-in): `make_room` refuses to move the
  clip's own video today (`packages/editor-core/src/ops/edit.ts`). Next plan, once this ships.
- Picking the last frame among several candidates, style from reference images, a style library, a world bible for
  long stories, merging adjacent shots into one long generation, audio-first videos.
- An auto-continue timer on any step.

## How to verify (end of plan)

```bash
npm run typecheck && npm run build
npm run test:editor-core
cd apps/web && npm run check:contracts && npm run check:pricing
npm run db:reset && npm run db:test
cd packages/engine && .venv312/bin/python -m pytest -q && .venv312/bin/python -m ruff check .
```

Plus Task 8's frames, looked at.
