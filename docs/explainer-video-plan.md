# Explainer videos: implementation plan (Remotion)

A new way to make a video in OpenCMO: describe a concept, approve a storyboard, and get a 30–90 second
animated explainer with a synced voice-over, placed on the clip as a video layer.

The reference is a 66-second "How Shazam hears a song in a noisy bar" video. Measured with ffmpeg:
- **One continuous scene.** No frame-to-frame change crosses a 0.02 scene score.
- **About 17 beats** of 3–4 seconds each.
- **A music bed under the narration** for the whole video, with no pause longer than 0.35 s.
- **A small visual vocabulary on a navy field:** glowing dots, lines, grids, a spectrogram, and labels of at most five words.
- **Colour carries meaning:** gold = signal, teal = answer, red = noise/wrong, grey = background.

## Decision (supersedes the first version of this plan)

**Render explainers with Remotion. The animation is not editable in the editor.**

The first version of this plan extended `clip-doc` + `clip-render`. The owner chose Remotion instead, for these reasons:
- Our own motion work has produced no animation good enough to ship.
- React + CSS + SVG in Chromium gives full visual power out of the box: glow, gradients, filters and text layout.
- Models write Remotion code far more reliably than they write our document format.
- Users do not need to edit the animation itself. They can still edit what sits around it: the voice-over, the captions, the trim, and the placement.

How it fits the "one system" rule in `CLAUDE.md`:
- The editor keeps one runtime.
- The explainer is **generated media**, like 3D Studio. In 3D Studio, the agent writes three.js code, it is previewed in a sandbox, Chromium renders it on Modal, and the MP4 lands on the clip (`packages/clip-three`, `generate-tool.ts` `add_3d_scene`, `modal_app.py` `render_three`).
- Remotion is a second renderer of generated media, not a second editor runtime.
- Update the "One system" line in `CLAUDE.md` in phase 0 so this is explicit.

## Licence and cost (check before phase 0 ends)

- **Remotion licence** (`remotion-dev/remotion/LICENSE.md`).
  - Free for individuals and for-profit companies with **up to 3 employees**.
  - Larger companies need a Company License.
  - The licence text does not address SaaS products that render for customers, so ask Remotion in writing before launch.
  - Remotion's pricing page lists "Remotion for Automators" at **$0.01 per render, $100/month minimum**.
  - Budget that from the first paying customer, or from the day the team reaches 4 people.
- **`remotion-dev/skills`** has no licence file. Read it to learn, but **do not copy its text** into our prompts.
- **Cost per video:**
  - Modal CPU time for the render;
  - the ElevenLabs voice (5 credits per 1,000 characters, about 5 credits for 60 s);
  - optional music;
  - $0.01 for Remotion.
- **Price.** Set the credit price in `packages/contracts/ai-models.json` like other generated media.

## What we take from existing work

| Source | What we take | Licence |
|---|---|---|
| Our 3D Studio (`packages/clip-three`) | The whole pipeline shape: `kit` helpers so the agent writes little code, a sandboxed preview with a layout report, a fix loop of at most 3 rounds, code stored by hash (`scene_codes`), an offline Chromium render on Modal, the approval card, and credits | ours |
| HyperFrames `skills/faceless-explainer` (heygen-com/hyperframes) | Story structures, hooks, cue-based narration, motion rules (power3 / critically damped spring, no bounce, ≤3 things moving), layout rules (hero at 40–60%, captions band at the bottom 17%, 3 depth layers), and cut at peak velocity | Apache-2.0: add a `THIRD_PARTY_NOTICES.md` row for adapted text |
| Code2Video (showlab, NeurIPS 2025 DL4C) | Planner → Coder → Critic. The Critic is a vision model reading rendered frames against "visual anchors"; the paper reports +40% over direct code generation | MIT (ideas only) |
| TheoremExplainAgent (TIGER-AI-Lab, ACL 2025) | Per-scene plans, an error-fix loop, and visual self-fix. Layout (overlap, off-frame) is the most common failure | MIT (ideas only) |
| manim-voiceover | Trigger an animation at a spoken word | ideas only |
| 3Blue1Brown / Manim | Transform what is already on screen instead of cutting to a new scene | ideas only |
| ElevenLabs text-to-speech with timestamps | Word timings for the narration | already returned by `elevenlabs-voice` (`words`) |
| `remotion-dev/skills` | Remotion idioms: `useCurrentFrame`, `interpolate`, `spring`, `<Sequence>`, `<Series>`, `<TransitionSeries>` | no licence: read only |

## Architecture

```
topic + brief + Brand Kit
  → Writer (beats: say, label, structure, hook)              [card 1: approve script]
  → voice generated (elevenlabs-voice) → word timings
  → Director writes composition code with the motion kit, timed to the words
  → preview_motion: server renders stills + layout report     [fix loop ≤ 3]
  → vision critic on the stills (anchor grid)                 [1 round]
  → moderation of every on-screen string
  → card 2: price + storyboard frames → approve
  → render_motion on Modal (Remotion renderMedia, offline Chromium) → MP4
  → MP4 + voice-over + captions placed on the clip (one Undo step)
```

Rules for the code and the render:
- **Code shape.**
  - The agent writes only the body of one React component.
  - It imports only from `@opencmo/clip-motion/kit` and `remotion`.
  - The bundler rejects every other import, plus `fetch`, `Date`, `Math.random` and timers. This is the same guard idea as `packages/clip-three/src/code/guard.ts`.
- **Rendering.**
  - Deterministic: every random value comes from `kit.random(seed)`.
  - Chromium runs offline, the same flags as clip-three `render.ts`.
- **What lands on the clip.**
  - The render is a silent MP4.
  - The voice-over stays a normal audio layer with captions, so voice and captions remain editable and re-timeable.
  - The video layer is named "Explainer: <title>".

## Phases

Each phase is one PR that leaves the product working.

### Phase 0: Licence, spike and go/no-go (2–3 days)

- Confirm the licence position in writing. Record the answer in this file.
- New package `packages/clip-motion` with `remotion`, `@remotion/bundler` and `@remotion/renderer`, pinned versions.
- Hand-write one 20–30 s composition in the reference style, with no AI involved, covering:
  - waveform → spectrogram → brightest peaks → pairs → scatter → line → check mark;
  - a voice from `elevenlabs-voice` and its word timings.
- Render it on Modal with `renderMedia`. Record:
  - wall time;
  - peak RAM (`/usr/bin/time -v`; must stay < 2 GB per job, so tune `concurrency` and `disallowParallelEncoding`);
  - cost per minute of video.
- **Look at the frames.**
- **Gate.** Continue only if the result is clearly as good as the reference.
- Update the "One system" line in `CLAUDE.md`.

### Phase 1: The motion kit and the Blueprint look (`packages/clip-motion/src/kit`)

React components and helpers the agent composes. Quality lives here, written and reviewed by people,
not generated per video.

- **Theme "blueprint".**
  - Navy field, vignette, hairline grid, soft bloom.
  - Semantic colours: gold = signal, teal = answer, red = wrong, grey = noise.
  - Fonts: DM Serif Display or Fraunces for narration, Source Code Pro for data, all bundled.
  - A Brand Kit replaces only the accent.
- **Primitives:**
  - `Title`, `Label` (with `swap` and `strike`), `DotField` (thousands of glowing dots, seeded), `Spectrogram` / `Heatmap`, `Waveform`;
  - `Axes`, `Scatter`, `FitLine`, `Link` (dot-to-dot lines that draw on), `Box` (dashed region), `Counter`, `Check`, `Icon`;
  - `Camera` (focus/zoom on a region).
- **Motion helpers:**
  - `enter`, `morph(a, b)` (point sets and paths, start-aligned), `filter(threshold)`, `highlight`, `dim`, `stagger`;
  - easing: power3 by default, a critically damped spring for heroes, no bounce.
- **Timing:**
  - `useWords()` exposes the narration word timings;
  - `cue("peaks")` returns the frame where that word is spoken;
  - `beat(i)` returns the frame span of a beat.
- **Layout guards:**
  - every primitive takes a region inside the safe area (top 83%);
  - `kit.layoutReport()` measures DOM boxes for overlap and off-frame.
- **Tests:**
  - unit tests for timing and morph alignment;
  - golden stills rendered with `renderStill` for each primitive (stored PNGs, mean-diff threshold, as in `editor-parity`).
- **Showcase composition:** the phase-0 spike rebuilt with the kit. It is the reference for prompts and evals.

### Phase 2: Storage, sandbox and render service

- **Code storage.**
  - Store composition code by hash, like `scene_codes`. Prefer reusing the table with a `kind` column, or add a sibling table, via the migration + RPC pattern.
  - Add a pgTAP test.
  - Run `scripts/dump-schema.sh` to regenerate `supabase/schema/current.sql`.
- **Model `motion-explainer`** in `ai-models.json`: a `generate` task kind like `studio-3d`, priced per second.
  - Credits go through `credit_hold` / `credit_settle` / `credit_refund`.
  - A failed render refunds.
- **Modal functions** in `modal_app.py`.
  - A separate image with Node, Chromium headless shell and `clip-motion` (keeps the worker image small).
  - `preview_motion`: bundle, then `renderStill` at 4–6 timestamps at half resolution, plus `layoutReport`. Returns JPEGs and issues within about 15 s.
  - `render_motion`: `renderMedia` H.264, then upload to Storage as library media.
  - Both run Chromium offline, with a watchdog per frame (as in clip-three).
- **Bundle cache.** Bundle the kit once per container. Agent code is compiled with esbuild into the bundle under an import allowlist.

### Phase 3: Voice first

- The Writer's beats become one narration. Generate it with `elevenlabs-voice`, which is the only provider with word timings; the card says so.
- Pass `words` and beat boundaries to the composition as `inputProps`. The Director writes against cues, not guessed seconds.
- On the clip, the voice-over is the normal `add_voiceover` layer with `captions: true`. Captions stay editable.
- **Re-voicing:**
  - If the user changes the voice or the narration, the explainer needs a re-render, at a price shown on the card.
  - Changing only the captions' style needs nothing.

### Phase 4: The Assistant (`apps/web/lib/agent`)

- **Recipe `explainer`** in `plan_video` (`video-team.ts`), behind `/explain` in `slash.ts`.
  1. **Writer** (tier `draft`).
     - Picks a structure (concept, process, listicle, story) and a hook.
     - Writes 8–14 beats with `say` (6–20 words) and `label` (≤ 5 words).
     - Prompt `EXPLAINER_WRITER` is adapted from HyperFrames story design (notice row).
     - **Card 1** shows the script for approval. This is free, so it costs nothing to iterate.
  2. **Voice.** Generated after approval (credits).
  3. **Director** (tier `draft`, the best coding model).
     - Writes the composition with the kit only.
     - Prompt `EXPLAINER_DIRECTOR`: the kit's API, motion and layout rules, and "transform what is already on screen".
  4. **`preview_motion`**: stills plus a layout report. Fix errors and layout issues, at most 3 rounds (the clip-three `preview_3d` loop).
  5. **Vision critic** (Code2Video idea).
     - Stills carry a numbered 10×10 anchor grid.
     - The critic lists overlap, off-frame text, unreadable text and empty space by cell.
     - The Director fixes once.
  6. **Moderation.** Every string literal in the code (as `codeGlyphs` does) plus the narration goes through `moderateText`.
  7. **Card 2** shows the price and the storyboard stills. Approval starts `render_motion`; the result is placed as one Undo step.
- **Register the route** in every list that names routes:
  - `SLOW_PLANS` in `limits.ts`
  - `providers/anthropic.ts`
  - `providers.check.ts`
  - `agent-design.check.ts`
  - `providers/fake.ts` (a fake composition)
  - `eval/tasks.ts`
  - `prompt.ts`
  - an `explainer` guide in `guides.ts`
  - `docs/spec-editor-assistant.md` §4–§5
- **Follow-up edits.** "Change beat 3", "make it 9:16" or "shorter" make the Assistant edit the stored code, preview, and re-render at a shown price. The previous version stays in the library.

### Phase 5: Editor UX

- `/explain` on a blank clip, and an "Explain a concept" entry on the New edit screen.
- A progress state on the layer while it renders (as for 3D Studio).
- Formats 16:9, 9:16 and 1:1. The kit lays out for the format; it does not crop.
- The landing page mentions it only once it works end to end.

### Phase 6: Measure before selling

- **Eval set: 12 topics.**
  - 4 about the product;
  - 4 technical (Shazam, DNS, HTTPS, vector databases);
  - 4 founder topics (CAC/LTV, product-market fit…).
- **Automatic scores:**
  - first-pass compile rate;
  - preview rounds needed;
  - critic issues left;
  - render time, peak RAM and cost per video.
- **Understanding check** (a small TeachQuiz). A model sees 5 frames plus the transcript and answers 3 questions about the topic.
- **Human rubric, 1–5 each:** hook, one idea per beat, continuity, legibility, pacing. Target ≥ 4.
- **Reliability:** pass^3 on the real model. Run by hand, never in CI.

## Files

- New: `packages/clip-motion/` (kit, compositions, render, guard, tests)
- `packages/engine/modal_app.py`, plus a worker task handler for `motion-explainer`
- `packages/contracts/ai-models.json`
- `supabase/migrations/*` + `supabase/tests/*` (code storage, model), `supabase/schema/current.sql`
- `apps/web/lib/agent/video-team.ts`, `motion-guide.ts`, `generate-tool.ts`, `slash.ts`, `guides.ts`, `limits.ts`, and the check and eval files
- `CLAUDE.md` (the "One system" line), `THIRD_PARTY_NOTICES.md`

## Verification for every phase

- `npm run typecheck`, `check:contracts --workspace @opencmo/web`, the `clip-motion` tests, and `npm run db:reset && npm run db:test` for migrations.
- After any kit or render change:
  - render the showcase;
  - extract frames from the full-size MP4 and look at them;
  - measure with `/usr/bin/time -v` (< 2 GB per job).
- End of phase 4: run `/explain` on 3 topics in `npm run dev` and watch the results with sound.
- End of phase 6: the 12-topic scorecard.

## Sources

- Remotion licence: https://github.com/remotion-dev/remotion/blob/main/LICENSE.md · pricing: https://www.remotion.dev/docs/license/pricing
- Remotion server rendering (`renderMedia`, `renderStill`, `bundle`): https://www.remotion.dev/docs/renderer/render-media
- Remotion skills (read only, no licence): https://github.com/remotion-dev/skills
- HyperFrames: https://github.com/heygen-com/hyperframes (`skills/faceless-explainer`)
- Code2Video: https://github.com/showlab/Code2Video, arXiv 2510.01174
- TheoremExplainAgent: https://github.com/TIGER-AI-Lab/TheoremExplainAgent, arXiv 2502.19400
- manim-voiceover: https://github.com/ManimCommunity/manim-voiceover
- ElevenLabs timestamps: https://elevenlabs.io/docs/api-reference/streaming-with-timestamps
- video-use: https://github.com/browser-use/video-use
