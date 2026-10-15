# Explainer v2: build plan (3 parallel sessions)

One branch (`explainer-v2`), one draft PR, three Claude sessions working in parallel. v1 is
`docs/explainer-build.md` (#51); read its Contracts first, this file only lists what changes.

## Why v2

The first production test (2026-10-15, one shot, no edits):

```
/explain How a vaccine teaches your immune system to fight a virus. 16:9, about 30 seconds, voice Aria.
```

The pipeline worked end to end, but the video did not explain the topic:

- **Nothing on screen was about vaccines.** Every beat was gold dots; "memory cells" was the `database` icon.
  The kit has no way to draw a cell, a virus, an antibody or a syringe: its marks are dots, spectrograms,
  plots, links, boxes and 16 tech icons, and the guide asks for "a navy field of glowing dots" for every topic.
- **The storyboard never described pictures.** A beat is `say` + a 5-word `label`, so neither the user nor
  the model decides what is drawn until the code is written.
- **No captions.** v1 left caption layers out on purpose; the bottom 17% of the frame is reserved and empty.
- **Too little text and too little motion.** One label at a time, at most 5 words, at most three things
  moving, and every mark has one layer of motion (appear, then stand still).
- **Two titles overlapped** around 27 s: a swap between beats. Preview stills are taken at beat midpoints
  only, so the layout report never sees transitions.

## Goal and acceptance test

The same one-shot vaccine prompt gives a video a viewer understands without the sound:

1. **The subject is on screen.** Each beat's stills show the things its narration names (virus, antibody,
   cell, syringe, shield…), drawn with icons, shapes or built-in Lottie animations. No unrelated icon.
2. **Captions** of the narration, word-timed, as an editable captions layer on the clip, visible by default.
3. **A text board** where the beat needs one: a title plus up to 3 short lines (steps, facts, numbers).
4. **Motion with three layers** (primary, secondary, ambient) and one motion personality for the whole video.
5. **No overlapping text** at any sampled frame, including the frames around every beat boundary.

**Done means it works when tested.** The PR is ready only when all of these pass:

1. `npm run check:clip-motion` passes (unit tests and golden stills, regenerated on purpose where v2 changes them).
2. The new fixture `packages/clip-motion/fixtures/vaccine.job.json` renders from the CLI; someone has looked at
   8 frames and named what each shows.
3. **Local, no paid keys** (`OPENCMO_MOTION=local`, `OPENCMO_MOTION_FAKE_VOICE=1`): `/explain` on a New edit shows
   a storyboard with a `visual` per beat → "go" → stills → approve → the explainer plays **with a captions layer**.
4. `apps/web/e2e/editor-explainer.spec.ts` passes, extended to find the captions layer and a text board still.
5. `npm run agent:eval -- --provider fake`: 41/41, including the new `explain-vaccine` task and a fixed `explain-make`.
6. **Deployed.** The owner runs the vaccine prompt and the two others from the test list on production, one shot.
   The result is judged against the five points above and written in Notes.

## Decisions

- **Subject first.** The storyboard names the picture of every beat before any code. The model maps each noun in
  the narration to something drawable: an icon from the full Lucide set (`find_icons`, ~1,850 icons, includes
  `virus`, `syringe`, `shield-check`, `dna`, `microscope`), a built-in Lottie (`find_lotties`: the CC0 OpenCMO pack
  and 143 Noto animated emoji), or a kit shape (cell, blob, ring, arrow, free path).
- **Reuse what the repo already has.** No new icon or animation library:
  - icons: `packages/clip-icons` (Lucide, ISC);
  - animations: `packages/clip-media/lottie` (CC0 + Noto CC BY 4.0), rendered with `@remotion/lottie`;
  - motion craft: the LottieFiles motion-design skill is already adapted in `apps/web/lib/agent/motion-guide.ts`
    and `packages/editor-core/src/motion/intro.ts` (`PERSONALITY`), with its notice in `THIRD_PARTY_NOTICES.md`.
    v2 extends that adaptation to explainers; nothing new is copied from the skill.
- **Craft lives in the kit, not in prose.** Personalities, anticipation, follow-through, secondary and ambient
  layers are kit behaviour, so a model that writes plain code still gets them.
- **Captions are a clip layer, not pixels.** The voice's word timings go back with the generation, and the editor
  adds a captions layer exactly as `sync_voiceover` does. The user can restyle, translate or hide it.
- **One look stays, a second is added.** `blueprint` (v1, navy) stays the default for tech and data topics;
  `paper` (light, flat, coloured shapes) is added for science, health, people and how-to topics.
- **Not in v2:** music, re-rendering one beat, a separate director sub-agent, user-uploaded Lottie in explainers,
  character rigs.

---

## Contracts (fixed; change only through a Request)

### `MotionJob` additions (`packages/clip-motion/src/job.ts`, Track A)

```ts
export const THEMES = ['blueprint', 'paper'] as const;           // default 'blueprint'
export const PERSONALITIES = ['premium', 'corporate', 'playful', 'energetic'] as const; // default 'premium'

// added to MotionJobSchema (both optional, so v1 jobs still parse):
theme: z.enum(THEMES).optional(),
personality: z.enum(PERSONALITIES).optional(),
```

`personality` uses the same names as `PERSONALITY` in `packages/editor-core/src/motion/intro.ts`; the explainer kit
scales those timings to beat length (Track A decides the factors and documents them in the README).

### Spec additions (Track B in SQL and the worker, Track C in the web)

```json
"scene": { "template": "explainer", "code_ref": "…", "title": "…", "beats": [ … ], "accent": "#…",
           "theme": "paper", "personality": "playful" }
```

- `theme` and `personality` are optional; SQL `ai_check_spec` accepts exactly the values above.
- Beats in the spec stay `{ say, label? }`. The storyboard's `visual` (below) is **not** in the spec: it is for
  the user and the model, and the scene must stay ≤ 4000 bytes.
- The price formula does not change.

### Generation words for explainers (Track B)

- `complete_generation` keeps `p_words` for explainer generations too (today only `kind = 'voice'`).
  The worker already has the words (`make_voice` in `opencmo/ai/providers/motion.py`, cut to the video length);
  it passes them as it does for voice.
- The editor reads them from the generation row the same way `useVoiceovers.ts` does.
- The fake voice has no words: the editor then adds no captions (no error).

### Op `sync_explainer` (Track C, `packages/editor-core`)

```ts
{ op: 'sync_explainer', element_id: string, words?: Word[] }   // agent: false, origin "system"
```

- Adds one captions layer `Captions · <explainer title>` built with `voiceTranscript(words)`, timed from the
  explainer layer's `start`, visible, default caption style. If a captions layer for that element exists, it
  updates its `src` instead. No words → no change.
- `CaptionsNode.source` = the explainer layer id (the own-video convention), so cut-by-words tools can read it.
- One Undo step, never folded into the user's edit (same as `attach_transcript`).

### Kit API v2 (Track A documents it in `packages/clip-motion/README.md`; Track C quotes it in the guide)

Everything in v1 stays. Added:

- **Theme and personality:** read from the job. `kit.theme`, `kit.personality`. `Stage` draws the theme's field
  (`paper`: warm off-white, soft shadow, no bloom). `kit.color` gains `ink`, `accent2`, `soft` for `paper`;
  meaning-colours (signal, answer, wrong, noise) keep their roles in both themes.
- **Things to draw:**
  - `<Icon name>` accepts **any Lucide name** from `packages/clip-icons` (unknown name → kit error listing the
    closest 5 names). `kit.icons` stays the list of the 16 v1 names for compatibility; the guide points the model
    to `find_icons` instead.
  - `<Lottie name x y size at? exitAt? loop? speed?>` plays a built-in animation from `packages/clip-media/lottie`
    (`walk`, `heart-beat`, `emoji/brain`, …). Files are bundled; nothing is fetched.
  - `<Shape kind="circle|cell|blob|ring|pill|capsule|star" x y size color? fill? label? />` with the kit's motion.
  - `<Path d x y size draw? />` — a free SVG path (24×24 box like icons) that draws itself.
  - `<Arrow from to curve? head? />` — like `Link` with a head; `<Group x y at keys?>` moves its children together
    (keys: `{ at, x, y, scale, rotate }`), with the personality's anticipation and settle.
  - `<Burst x y at count? color?>` — a short particle burst (success, impact).
- **Text board:**
  - `<Headline items={[{ text, at }]} />` — the one headline row; each item replaces the previous with an exit
    that finishes before the next enters, so headlines can never overlap. The guide uses it instead of several
    `Label`s.
  - `<Board title? lines={['…', '…', '…']} at area? kind="steps|facts|compare" />` — up to 3 lines of at most 8 words,
    revealed one by one on cues.
- **Motion craft (from the personality):**
  - every entrance gets anticipation and a settle; `kit.enter` keeps its v1 signature, the personality supplies
    defaults;
  - `secondary` prop on marks: a glow/shadow that follows 3–5 frames late;
  - `Stage ambient` (default on): slow drift of the field opposite to the camera, a soft pulse on the latest
    primary mark;
  - `kit.react(at, { from: [x, y] })` — nearby marks nudge away and settle (reaction to an impact).
- **Layout report:** stills sampled at beat midpoints **and 6 frames after every beat start**; new issues
  "beat N shows no icon, shape or Lottie" and "nothing moves during beat N" (box positions unchanged between two
  samples of the beat).

### Storyboard (Track C)

`preview_explainer` and `add_explainer` inputs gain, per beat:

```ts
visual: z.string().trim().min(1).max(160)   // "a syringe enters left; a virus icon splits into 3 grey fragments"
```

The `/explain` reply shows `say`, `label` and `visual` for each beat; the approval card lists `visual` too.

---

## How the three sessions work together

1. **Branch.** Everyone works on `explainer-v2`. Before every task and every push, run
   `git pull --rebase origin explainer-v2`. Never force-push.
2. **Ownership.** Edit only your own files (table below). Need something in another track's file? Add a line
   under [Requests](#requests) and keep going. The owner picks it up.
3. **Contracts first.** Track A's first push: `job.ts` with `theme`/`personality`, `Icon` on the full Lucide set,
   `Headline`. Track B's first push: the migration with `theme`/`personality` checks and explainer words.
   Until then, code against the contracts above.
4. **Small commits:** `explainer-v2 A3: Lottie in the kit`. English only.
5. **Tick your own boxes** and add a line under your Notes in the same commit.
6. **Green before push:** `npm run typecheck` plus your track's checks. A red push blocks the other two.
7. **Verify by looking** (`CLAUDE.md`). Extract frames from full-size renders and look at them. Say in Notes what
   each frame shows.
8. **Project rules hold:** writes through ownership-checking RPCs; money only through
   `credit_hold` / `credit_settle` / `credit_refund`; every migration has a pgTAP test, then `scripts/dump-schema.sh`;
   user-facing errors in English; no "coming soon"; Peak RAM per render < 2 GB.

| Track | Owns |
|---|---|
| **A: Kit & renderer** | `packages/clip-motion/**` |
| **B: Render service & data** | `packages/engine/**`, `packages/contracts/**`, `supabase/**`, `apps/web/lib/motion/**` |
| **C: Assistant & editor** | `apps/web/**` except `apps/web/lib/motion/**`, `packages/editor-core/**`, `THIRD_PARTY_NOTICES.md`, `docs/spec-editor-assistant.md` |

`packages/clip-icons` and `packages/clip-media` are read-only for everyone; a change there is a Request to the owner.

---

## Track A: Kit & renderer (`packages/clip-motion`)

- [x] **A1. Contract.** `theme` and `personality` in `job.ts` (optional, defaults as above); `kit.theme`,
  `kit.personality`; v1 fixtures still parse and render unchanged. **Push this first.**
- [x] **A2. Every Lucide icon.** `Icon` reads `packages/clip-icons/data/icons.json` (bundled into the Remotion
  bundle; ~720 KB, no fetch). Unknown name → kit error with the 5 closest names. Keep the draw-on animation.
  Test: `virus`, `syringe`, `shield-check` render; `virsu` suggests `virus`.
- [x] **A3. Lottie.** Add `@remotion/lottie` pinned to the same version as `remotion` (4.0.530). `<Lottie>` loads
  JSON from `packages/clip-media/lottie` through the bundle (`staticFile` stays forbidden to scene code; the kit
  resolves the name). Only names in `BUILTIN_LOTTIES()` (`packages/editor-core/src/visuals/lottie.ts`) — copy the
  list into a generated `src/kit/lotties.ts` with a test that it matches the folder. Frame-exact: driven by
  `useCurrentFrame`, no wall clock. **Measure** render time with 3 Lotties on screen vs without.
- [x] **A4. Shapes, Path, Arrow, Group, Burst** as in the contract, all with layout tags.
- [x] **A5. Text board.** `Headline` (exits always finish before the next entrance) and `Board`. Fix the v1
  overlap: a `Label` swap must never show two texts at full opacity in the same frame.
- [ ] **A6. Theme `paper`.** Off-white field, flat colours, soft shadows, fonts already in
  `packages/clip-media/fonts` (e.g. Fraunces titles, DM Sans or Figtree text); same meaning-colours. Golden stills for both themes.
- [ ] **A7. Personalities and motion layers.** Map `PERSONALITY` (premium, corporate, playful, energetic) to kit
  defaults scaled for beats (entrance/exit frames, overshoot, stagger). Anticipation + settle on entrances,
  `secondary` follow, `Stage ambient`, `kit.react`. Golden stills per personality only where motion is frozen.
- [ ] **A8. Layout report v2.** Sample beat midpoints + 6 frames after each beat start; add the two new issues.
- [ ] **A9. Fixture and README.** `fixtures/vaccine.job.json` written only with the v2 kit (the reference scene for
  the guide); README documents every v2 component with one example each and the "do and don't" list for the
  guide (Track C quotes it).
- [ ] **A10. Measure.** 60 s vaccine job at 1080p on 4 vCPU: wall time, ms/frame, peak RSS (< 2 GB). Notes.

**Checks:** `npm run check:clip-motion`; CLI render of `vaccine.job.json`; 8 frames looked at.

## Track B: Render service & data

- [x] **B1. Migration** `supabase/migrations/<ts>_explainer_v2.sql` + `supabase/tests/<n>_explainer_v2.test.sql`:
  - `ai_check_spec`: explainer scenes accept `theme` ∈ {blueprint, paper} and `personality` ∈ {premium, corporate,
    playful, energetic}; anything else is rejected with "This explainer script is not valid. Write it again.";
  - `complete_generation`: keep `p_words` for explainer generations (provider `opencmo-motion`), same size limits
    as voice;
  - `scripts/dump-schema.sh`. **Push this first.**
- [ ] **B2. Worker.** `motion_job()` passes `theme`/`personality` into the job; `generate_task.py` passes the
  explainer's words to `complete_generation`. Tests in `tests/test_ai_motion_provider.py` and
  `tests/test_worker_generate_task.py`.
- [ ] **B3. Modal image.** `motion_image` carries `packages/clip-media/lottie` and `packages/clip-icons/data`
  (the bundle needs them); the warm-up render uses `vaccine.job.json` at scale 0.25. Concurrency defaults to the
  container's real core count (`os.cpu_count()`), capped at 4 — no more 1-core build failures.
- [ ] **B4. Faster previews.** Open Chromium once per container and reuse it for every preview
  (`@modal.enter`, Remotion's browser reuse); measure a warm and a cold preview. Decide with the owner whether
  `motion_preview` keeps one warm container (`min_containers=1`) — write the monthly cost in Notes first.
- [ ] **B5. Own preview token.** `motion_preview` checks a new `MOTION_PREVIEW_TOKEN` (secret `opencmo-motion`,
  Vercel env), not the worker token: the container that runs model-written code must not hold a token that can
  submit tasks. `apps/web/lib/motion/preview.ts` sends it; fall back to `OPENCMO_WORKER_TOKEN` for one deploy only.
- [ ] **B6. Measure on Modal** (carried over from v1 B6): showcase and vaccine jobs, cold and warm; time, cost per
  video, cold start. Check the real voice length against the 2.4 words/s estimate on 3 scripts; if ElevenLabs
  reads slower, lower `WORDS_PER_SECOND` in `packages/clip-motion/src/job.ts` (Request to A) and
  `packages/editor-core/src/explainer.ts` (Request to C) together. Set the price in `ai-models.json`.

**Checks:** `npm run db:reset && npm run db:test`; engine `pytest` + `ruff`; `npm run check:contracts --workspace @opencmo/web`.

## Track C: Assistant & editor

- [ ] **C1. Storyboard.** `visual` per beat in `preview_explainer` / `add_explainer` inputs; the `/explain` reply
  and the approval card show it; `add_explainer` passes `theme`/`personality` into the spec. Fake provider updated.
- [ ] **C2. Guide v2** (`apps/web/lib/agent/guides.ts`, `explainer`):
  - choose `theme` and `personality` from the topic and the user's words (tables, 4 lines each);
  - **subject first:** for every beat, list the nouns of `say`, find each with `find_icons` / `find_lotties` or
    pick a kit shape, and write that into `visual` before any code; never use an icon whose name does not match
    the noun;
  - one `Headline` row, a `Board` when a beat lists steps, facts or numbers;
  - every beat has a primary, a secondary and an ambient motion; extend `motion-guide.ts`'s adaptation of the
    LottieFiles skill to beats of 3–6 s (no new text copied from the skill);
  - quote the kit README's v2 API and do/don't list (Track A9).
- [ ] **C3. Subject check in the preview loop.** After `preview_explainer`, the model writes one line per still:
  "shows X; the beat says Y" and fixes any beat where they differ; the tool result reminds it to.
- [ ] **C4. Captions.** Op `sync_explainer` in editor-core (tests next to `src/voiceover.test.ts`); the editor runs it
  when an explainer generation lands with words (`useGenerations.ts` / a hook like `useVoiceovers.ts`), and also
  once for explainers placed before v2 when their generation has words.
- [ ] **C5. Evals.** Fix `explain-make` (the fake honours "go ahead"); add `explain-vaccine`: the grader reads the
  scene code and the storyboard and wants every beat's `visual` to name an icon, Lottie or shape that exists, at
  least 3 subject icons (`virus`, `syringe`, `shield…`, `dna`…) and no `database`/`server` icon, a `Headline`,
  and `theme`/`personality` set.
- [ ] **C6. e2e.** `editor-explainer.spec.ts`: storyboard shows `visual`; after render a captions layer
  `Captions · …` exists and is visible (fake voice: seed words through the fake transcriber the way
  `editor-roughcut` does); look at one frame with the board.
- [ ] **C7. Notices.** `THIRD_PARTY_NOTICES.md`: add the explainer files to the motion-design row; add
  `@remotion/lottie` (Remotion licence) and the Noto emoji use in explainers.

**Checks:** `npm run typecheck`; `npm run check:contracts --workspace @opencmo/web`;
`npm run agent:eval --workspace @opencmo/web -- --provider fake`; `npm run test:e2e -- editor-explainer`.

---

## Test prompts (the owner runs these on production at the end)

```
/explain How a vaccine teaches your immune system to fight a virus. 16:9, about 30 seconds, voice Aria.
/explain How compound interest turns small monthly savings into a large amount over 30 years. Show the money growing year by year with a chart. 9:16, about 60 seconds, voice Roger.
/explain How Shazam recognises a song in a noisy bar: spectrogram, peaks, fingerprints, matching. 16:9, about 45 seconds, voice Charlotte.
```

Record per run: seconds from "go" to stills, seconds from Approve to playing, credits, whether the last sentence
is cut, the five acceptance points (yes/no each), and the Modal cost of `render_motion` and `motion_preview`.

---

## Notes

### Track A

- A1: `THEMES`, `PERSONALITIES`, `DEFAULT_THEME`, `DEFAULT_PERSONALITY` and the optional `theme` / `personality`
  fields in `job.ts`; `kit.theme`, `kit.personality`. A job without them is v1: the `premium` personality keeps
  v1 motion, and the ambient layer is on by default only when the job sets a personality, so the showcase golden
  stills stay valid. `check:clip-motion` green.
- A2: `src/assets.ts` assembles the bundle's public dir (fonts + `icons.json` + `lottie/`), cached by an asset
  hash; the page loads `icons.json` once before the first frame (`src/remotion/assets.ts`). `Icon` takes any
  Lucide name, v1 names keep their drawings, an unknown name fails with the closest 5 (`virsu` → `virus, …`).
  Looked at a preview still: virus (wrong), syringe (signal) and shield-check (answer) drawn correctly.
  **Request to B (B3):** the Modal image needs `packages/clip-icons/data/icons.json` and `packages/clip-media/lottie`
  next to `packages/clip-motion` (or set `OPENCMO_MOTION_ICONS` / `OPENCMO_MOTION_LOTTIE`).
- A3: `@remotion/lottie` 4.0.530 (exact, like `remotion`; it adds `lottie-web` 5.13.0 to `package-lock.json`).
  `<Lottie name>` plays a built-in animation from the bundle inside a `Sequence` starting at `at`, so it follows
  the frame. `src/kit/lotties.ts` is generated from the folder by `scripts/build-lotties.ts` (165 names: 22 OpenCMO
  CC0 + 143 `emoji/*` Noto CC BY 4.0); a test keeps it equal to the folder. Unknown name → kit error with close
  names. Looked at a still (heart-beat, emoji/brain, walk all drawn); frames 3.0 s and 3.5 s differ, so they move.
  **Measured** (15 s, 1080p, this laptop, concurrency 2): 3 icons 40 ms/frame, 18.8 s, peak RSS 725 MB; 3 Lotties
  45 ms/frame, 20.8 s, 736 MB.
- A4: `src/kit/shapes.tsx`: `Shape` (circle, cell, blob, ring, pill, capsule, star; `label`, `secondary` halo,
  `breathe`), `Path`, `Arrow` (head pops in), `Group` (keys + `react` knock), `Burst`. Also the base of A7, because
  every new mark uses it: `src/kit/personality.ts` (`MOTION` per personality, `pop` with wind-up and overshoot,
  `wobble`), `MotionContext` / `ThemeContext`, and `useLife` now returns `pop` and scales its default lengths to
  the personality. A job without `personality` keeps v1 timings exactly (golden stills unchanged). Looked at stills
  of a `playful` test scene: every shape drawn, the cell's halo, the blob changing outline, the virus group moving
  left at its key, knocked right at the impact and settling, the burst at the impact.
- A5: `src/kit/board.tsx`: `Headline` (one row; an item leaves fully before the next enters) and `Board`
  (steps/facts/compare, ≤ 3 lines of ≤ 8 words). Root cause of the 27 s overlap: a text's exit STARTED at `exitAt`
  while the next text entered at the same frame (the showcase itself does this). Text exits now END at `exitAt`, and
  `swapTo` is sequential. Golden `showcase-100.png` regenerated on purpose (the title is now gone by the next label;
  old and new compared side by side); the other three goldens unchanged. Looked at stills at frames 136/140/200:
  old headline fading, new one rising word by word, no overlap; the steps board reads well.

### Track B

- B1: `20261126090000_explainer_v2.sql` + `156_explainer_v2.test.sql`. `ai_check_spec` takes `scene.theme` /
  `scene.personality` from the fixed lists (wrong type, `null` or an unknown name → "This explainer script is not
  valid. Write it again."; a beat `visual` is refused too); `complete_generation` keeps words for models whose
  provider is `opencmo-motion`. `supabase test db`: 89 files, 1446 tests pass (CLI 2.117.0); schema dumped.

### Track C

---

## Requests

Cross-track asks. Format: `- [ ] (from X → owner Y) what and why`. The owner ticks it when done.

- [ ] (from A → owner B) B3: copy `packages/clip-icons/data/icons.json` and `packages/clip-media/lottie` into
  `motion_image` at the same relative paths as in the repo (`<root>/packages/clip-icons/data`,
  `<root>/packages/clip-media/lottie`); the bundle reads them from there (env overrides in the clip-motion README).
