# Explainer videos: implementation plan

A new way to make a video in OpenCMO: describe a concept, approve a storyboard, get a 30–90 second
animated explainer with a synced voice-over. The document stays editable in the editor like any other clip.

The reference is a 66-second "How Shazam hears a song in a noisy bar" video. Measured with ffmpeg:
- **One continuous scene.** No frame-to-frame change crosses a 0.02 scene score.
- **About 17 beats** of 3–4 seconds each.
- **A music bed under the narration.** It runs throughout, with no pause longer than 0.35 s.
- **Only a few kinds of marks:** glowing dots, lines, grids, a spectrogram, and labels of at most five words on a navy field.
- **Colour carries meaning:** gold = signal, teal = answer, red = noise/wrong, grey = background.

Each beat transforms the objects of the previous one: bar → waveform → spectrogram → brightest peaks →
paired stars → `f1 | f2 | gap` → millions of songs → scatter → straight line → "Song named."

## Decisions

1. **Build it in the existing system, not a second runtime.** `CLAUDE.md` rules out a second runtime,
   so no Remotion, HyperFrames or Manim. Most of what the reference needs already exists:
   - `clip-doc` + `clip-render` already morph paths with any point count (`clip-doc/src/path.ts:491-607`).
   - They also draw lines on (`trimStart`/`trimEnd`, `dash`) and support shadows, 16 blend modes and 32 fonts.
   - The intro pipeline (`editor-core/src/motion/intro.ts`, `apps/web/lib/agent/video-team.ts`) is
     the template: Writer → Director → code reviewer → builder → one op → one Undo step.
2. **The model writes a spec, code builds it.** The LLM picks structure, beats, words and primitives; it never
   picks colours, fonts or easing. That is why every video comes out consistently good. Code2Video and
   TheoremExplainAgent generate Manim code and report layout as their main failure, so we keep the model
   away from coordinates where we can.
3. **One continuous scene with persistent objects.** It is not a list of overlays that fade in and out.
4. **Voice first, visuals follow the real word timings.**
5. **Cost.** No video model is involved. The only paid parts are the ElevenLabs voice (5 credits per
   1,000 characters, about 5 credits for a 60 s script) and optional music.

## What we take from existing work

| Source | What we take | Licence |
|---|---|---|
| HyperFrames `skills/faceless-explainer` (heygen-com/hyperframes) | Story design, motion language, visual design and seam-cut rules. Details below the table | Apache-2.0: add a `THIRD_PARTY_NOTICES.md` row for adapted text |
| Code2Video (showlab, NeurIPS 2025 DL4C) | Planner → Coder → Critic. The Critic is a vision model that reads rendered frames against "visual anchors" and fixes layout; the paper reports +40% over direct code generation | MIT (ideas only) |
| TheoremExplainAgent (TIGER-AI-Lab, ACL 2025) | Per-scene plans, an error-fix loop, and visual self-fix from rendered frames. Layout problems (overlap, off-frame) are the most common failure | MIT (ideas only) |
| manim-voiceover | Trigger an animation at a spoken word | ideas only |
| 3Blue1Brown / Manim | Transform the object that is already there instead of replacing the scene | ideas only |
| LottieFiles motion-design-skill | Personality, stagger, at most 3 things moving | MIT, already in `motion-guide.ts` |
| ElevenLabs text-to-speech with timestamps | Word timings for the narration | already returned by `elevenlabs-voice` (`words`) |
| browser-use/video-use | Propose before executing, self-check at most 3 passes, report numbers | check licence before quoting text |

What HyperFrames teaches:
- **Structures.** Four of them: concept, process, listicle, story.
- **Hooks.** Nine kinds: statistic, question, counterintuitive claim, and others.
- **Narration.** 6–20 words per frame, split into cues so each element appears when it is named.
- **Pacing.** Nearly nothing in the first 25% of a frame; reveal on cue in the back half.
- **Easing.** power3 by default, a critically damped spring (ζ=1) for the hero, never bounce.
- **Layout.**
  - The hero fills 40–60% of the frame.
  - The bottom 17% is kept for captions.
  - At least 3 depth layers.
- **Seam cuts.** Cut at peak velocity, with matching direction and speed on both sides.
- **Motion.** "No motion beats bad motion."

## Gaps found in the code

1. **No primitive draws many marks.**
   - A glowing dot (rect + shadow + 2 tracks) is about 430 B, so the 256 KB document cap
     (`clip-doc/src/validate.ts:13`) holds about 550.
   - A 64×32 heatmap built from rects is about 225 KB.
2. **`glow` only grades media frames** (`clip-render/src/grade.ts:567`), not paths, rects or text. The cost
   of `shadowBlur` on hundreds of nodes has never been measured.
3. **Morphs can twist.** The start point and direction are not aligned, and there is no parity sample for morph.
4. **Missing text and camera helpers.** There is no label swap or strike-through preset, and no 2D camera helper.
5. **Visuals are standalone overlays** (`editor-core/src/visuals/common.ts:251` `visualGroup`). Each one fades
   out at its own end, and no object lives across beats.
6. **Visuals are never re-timed to the real voice.** `sync_voiceover` only sets the audio `end`
   (`editor-core/src/ops/voiceover.ts:166-230`).
7. **`plan_video` only knows `recipe: "intro"`** (`apps/web/lib/agent/video-team.ts:21`).

## Phases

Each phase is one PR that leaves the product working.

### Phase 0: Hand-built prototype and a go/no-go gate (2–3 days)

- Script `packages/editor-core/scripts/explainer-prototype.ts` builds a 30 s document directly from
  existing nodes:
  - a group as camera;
  - path morphs;
  - rect dots with shadows;
  - text.

  Topic: "How OpenCMO finds Reddit threads worth replying to".
- Export with `clip-export` on Node. Record:
  - peak RAM and wall time (`/usr/bin/time -v`);
  - `storedBytes`;
  - time per frame.
- Extract frames from the full-size file and look at them.
- **Gate.** Continue to phase 2 only if all of these hold:
  - morphs are smooth;
  - dots read as glowing;
  - export stays inside the budgets;
  - the document stays under 40% of the cap.

  Otherwise do phase 1 first. Phase 1 is likely needed anyway for the dot fields.

### Phase 1: Schema and renderer (`clip-doc`, `clip-render`)

1. **`marks` node kind** in `clip-doc/src/schema.ts`, added to `NodeSchema`. It draws many marks from one compact node.
   - `layout: "points"`: a flat `[x, y, ...]` array quantised to 0–1000, plus optional `size[]` and `class[]`.
   - `layout: "cells"`: `cols × rows` with `values` 0–255 and a palette ramp (navy → teal → gold), for spectrograms and heatmaps.
   - `classes`: per-class style `{color, radius, glow, opacity}`.
   - `reveal`: stagger order (`x`, `y`, `value`, or `random` with a required `seed`) and duration.
   - `morphTo`: a second dataset with the same keys, driven by a `progress` track.
   - `threshold` track: marks below it fade out ("keep only the brightest peaks").
   - Validation:
     - at most 4,000 points or 128×64 cells;
     - a `seed` whenever anything is random, so renders stay deterministic.
   - Size: 500 quantised points are about 5 KB.
2. **Draw `marks`** in a new `clip-render/src/marks.ts`.
   - Glow comes from a cached radial-gradient sprite per (colour, radius) drawn with `drawImage`, not from `shadowBlur`.
   - Cells go through one offscreen bitmap per frame (`putImageData`), scaled with smoothing off.
   - Same code in the browser and on Node.
3. **Vector glow.** `glow {color, radius, intensity}` on path, rect and text.
   - Drawn as a blurred pass under a sharp pass with `screen` blend.
   - Cost is bounded and counted in `visualCost`.
4. **Better morphs** in `clip-doc/src/path.ts`.
   - Rotate the start index to the closest point.
   - Reverse the path when the directions differ.
   - Unit tests for both.
5. **Text presets** `swap` and `strike` in `animations`: strike the old label, then swap in the new one.
6. **Tests.**
   - Parity samples with `"oracle": "opencmo"`: `marks-points`, `marks-cells`, `path-morph`, `vector-glow`, `text-swap`.
   - A Node benchmark: 2,000 glowing dots at 1080p in at most 16 ms per frame.
   - A 60 s export must stay under 2 GB peak RAM.

### Phase 2: `ExplainerSpec`, builder and reviewer (`editor-core/src/motion/explainer.ts`)

Modelled on `intro.ts`, but one continuous scene.

```ts
type ExplainerSpec = {
  structure: 'concept' | 'process' | 'listicle' | 'story';
  format: '16:9' | '9:16' | '1:1';
  objects: {
    id: string;
    kind: 'title' | 'label' | 'points' | 'cells' | 'wave' | 'axes' | 'line' | 'link' | 'box' | 'counter' | 'icon' | 'check';
    role: 'hero' | 'support' | 'background';
    data?: unknown; // per kind, validated by zod
  }[];
  beats: {
    id: string;
    say: string;    // narration, 6–20 words
    label?: string; // on-screen words, ≤ 5
    actions: {
      do: 'enter' | 'morph' | 'filter' | 'highlight' | 'dim' | 'connect' | 'swapLabel' | 'camera' | 'exit';
      target: string;
      to?: unknown;
      at?: `cue:${string}` | number; // a spoken word, or 0–1 of the beat
    }[];
  }[];
};
```

- **Theme "blueprint"** in `visuals/common.ts`.
  - Navy field with a vignette and a hairline grid.
  - Gold = signal, teal = answer, red = wrong, grey = noise.
  - Fonts: DM Serif Display (or Fraunces) for narration labels, Source Code Pro for data.
  - A Brand Kit only replaces the accent; the colour meanings stay.
- **Builder** `buildExplainer(spec, frame, timing)`.
  - One root group acts as the camera.
  - Objects keep their ids for the whole video.
  - Each action becomes keyframes on the same object.
  - Easing: power3 by default, a critically damped spring for the hero.
  - Writes `marks.visual = {op: 'explainer', input: spec}` so `update_visual` can rebuild it.
- **Reviewer** `reviewExplainer`: pure code, returns messages the model can act on.
  - labels of at most 5 words;
  - 6–20 words per beat and at least 1.2 s of reading time;
  - at most 3 objects moving at once;
  - the hero at 40–60% of the frame;
  - nothing in the bottom 17%;
  - `storedBytes` at most 60% of the cap;
  - every action targets an existing object;
  - every beat transforms at least one object of the previous beat (no hard cuts).
- **Op `add_explainer`** (`agent: false`, like `add_intro`).
  - `set_frame` for the format.
  - The explainer group.
  - One `add_voiceover` for the whole narration with `captions: true`.
  - An optional music bed with ducking.
- **Tests** in the style of `motion/intro.test.ts`: build → `applyOps` → `validate`, plus every reviewer failure.

### Phase 3: Sync to the real voice (`ops/voiceover.ts`, `components/editor/generate/useVoiceovers.ts`)

- Beats start out timed from the 3 words/s estimate.
- **Op `retime_explainer {key, words}`**:
  - Takes the word timings `sync_voiceover` already receives.
  - Maps each beat to the first word of its `say`, and each `cue:<word>` to that word.
  - Stretches the beat's keyframes to the real span.
  - Runs with `history: false` in the same call as `sync_voiceover`, so it is bookkeeping, not an Undo step.
- **Voice.** Explainers use `elevenlabs-voice` only, because Gemini voice returns no timings. The card says so.
- **Tests:**
  - word timings off by ±30% still line up;
  - a missing word keeps the estimate and reports a warning.

### Phase 4: The Assistant (`apps/web/lib/agent`)

`video-team.ts`: `recipe: z.enum(["intro", "explainer"])`. `prepareExplainer` runs these steps.

1. **Writer** (tier `draft`).
   - Reads the topic, the brief and the Brand Kit.
   - Picks one structure and one hook type.
   - Writes 8–14 beats with `say`, `label`, `persuasion` and `emotion`.
   - Prompt `EXPLAINER_WRITER` in `motion-guide.ts`, adapted from HyperFrames story design.
2. **Visual director** (tier `draft`).
   - Turns the beats into an `ExplainerSpec` using only the listed primitives and actions.
   - Prompt `EXPLAINER_DIRECTOR` combines the motion-language rules, the visual-design rules and
     "transform what is there".
3. **Reviewer.** `reviewExplainer`, at most 2 fix rounds.
4. **Critic with eyes**, after Code2Video and TheoremExplainAgent.
   - Render the middle frame of every beat with `clip-render` on the server, with a numbered 10×10 anchor grid.
   - A vision model lists layout problems by grid cell: overlap, off-frame, text too small, empty space.
   - The director fixes once.
   - The numbers are logged. There is no open-ended loop.
5. **Moderation.** Every `say` and label goes through `moderateText` before the card.

**Card.** `Storyboard` with columns `["Beat", "Voice", "On screen"]`. Credits are the voice, plus music if any.
Approving applies `add_explainer` as one Undo step.

**Register the route everywhere it is listed:**
- `SLOW_PLANS` in `limits.ts`
- `providers/anthropic.ts:197`
- `providers.check.ts`
- `agent-design.check.ts`
- a fake spec in `providers/fake.ts`
- `eval/tasks.ts`
- `/explain` in `slash.ts`
- `prompt.ts`
- an `explainer` guide in `guides.ts`
- `docs/spec-editor-assistant.md` §4–§5

### Phase 5: Editor UX

- `/explain` on a blank clip, and an "Explain a concept" entry on the New edit screen.
- Inspector for `marks`: class colours, seed, density.
- Labels and narration editable in place.
- "Regenerate this beat" through `update_visual`, keeping the user's transform edits.
- The landing page mentions it only once it works end to end.

### Phase 6: Measure before selling

- **Eval set: 12 topics.**
  - 4 about the product (OpenCMO, SaaS pricing…);
  - 4 technical (Shazam, DNS, HTTPS, vector databases);
  - 4 founder topics (CAC/LTV, product-market fit…).
- **Automatic scores:**
  - reviewer pass;
  - critic issues left;
  - `storedBytes`;
  - export time and peak RAM.
- **Understanding check** (a small TeachQuiz). A model sees 5 frames plus the transcript and answers 3 questions about the topic.
- **Human rubric, 1–5 each:** hook, one idea per beat, continuity, legibility, pacing. Target ≥ 4.
- **Reliability:** pass^3 on the real model. Run by hand, never in CI (costs money).

## Files

- `packages/clip-doc/src/schema.ts`, `path.ts`, `validate.ts`
- `packages/clip-render/src/draw.ts`, `frame.ts`, new `marks.ts`
- `packages/editor-core/src/motion/explainer.ts` (new), `ops/voiceover.ts`, `ops/visuals.ts`, `visuals/common.ts`
- `packages/editor-parity/samples/*`
- `apps/web/lib/agent/video-team.ts`, `motion-guide.ts`, `slash.ts`, `guides.ts`, `limits.ts`, and the check and eval files
- `apps/web/components/editor/generate/useVoiceovers.ts`
- `THIRD_PARTY_NOTICES.md`

## Verification for every phase

- `npm run typecheck`, `check:clip-doc`, `check:clip-render`, `check:editor-core`,
  `check:contracts --workspace @opencmo/web`, and Node parity.
- After any renderer change:
  - export;
  - extract frames from the full-size file and look at them;
  - measure with `/usr/bin/time -v`.
- End of phase 4: run `/explain` on 3 topics in `npm run dev`, watch the result, and edit a label in the editor.
- End of phase 6: the 12-topic scorecard.

## Sources

- HyperFrames: https://github.com/heygen-com/hyperframes (`skills/faceless-explainer/SKILL.md`, `references/story-design.md`,
  `motion-language.md`, `visual-design.md`, `cut-catalog.md`, `sub-agents/frame-worker.md`)
- Code2Video: https://github.com/showlab/Code2Video, arXiv 2510.01174
- TheoremExplainAgent: https://github.com/TIGER-AI-Lab/TheoremExplainAgent, arXiv 2502.19400
- manim-voiceover: https://github.com/ManimCommunity/manim-voiceover
- ElevenLabs timestamps: https://elevenlabs.io/docs/api-reference/streaming-with-timestamps
- Motion Canvas transitions: https://motioncanvas.io/docs/transitions
- Remotion skills: https://github.com/remotion-dev/skills
- video-use: https://github.com/browser-use/video-use
