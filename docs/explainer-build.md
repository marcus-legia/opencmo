# Explainer videos: build plan (3 parallel sessions)

One branch (`explainer`), one draft PR, three Claude sessions working in parallel. This file replaces the
earlier explainer plans (#49, #50).

## Goal and acceptance test

The user types `/explain <topic>` in the Assistant, approves a script and a price, and gets a 15–90 s animated
explainer with narration, placed on the clip as one video layer. The style follows the reference video
"How Shazam hears a song in a noisy bar":
- **One continuous scene:** no hard cuts.
- **About 4 s per beat**, each beat transforming what is already on screen.
- **A navy field** carrying glowing dots, lines, grids, spectrograms and labels of at most 5 words.
- **Colour has meaning:** gold = signal, teal = answer, red = wrong, grey = noise.

**Done means it works when tested.** The PR is ready only when all of these pass:

1. `npm run check:clip-motion` passes (unit tests and golden stills).
2. Rendering the showcase job from the CLI produces a correct 1080p MP4 with peak RSS under 2 GB:
   `node packages/clip-motion/src/cli.ts render packages/clip-motion/fixtures/showcase.job.json /tmp/showcase.mp4`.
   Someone has looked at 6 extracted frames.
3. **Local, no paid keys.** With `npm run dev`, `OPENCMO_MOTION=local` and `OPENCMO_MOTION_FAKE_VOICE=1`, on a New edit:
   1. `/explain How Shazam recognizes a song in a noisy bar` → the Assistant shows the script.
   2. "go" → preview stills appear in the panel → an approval card with a price.
   3. Approve → a layer "Explainer: …" shows render progress, then plays.
   4. Ctrl+Z removes it, and Export includes it.
4. `apps/web/e2e/editor-explainer.spec.ts` passes, with the fake agent and local motion.
5. **Deployed.** On a Vercel preview with Modal deployed: the same flow with the real ElevenLabs voice, for 16:9 and 9:16.

## Decisions

- **Remotion renders the animation, and the animation is not editable.**
  - Our own motion work never reached shipping quality.
  - React, CSS and SVG in Chromium give glow, gradients and text layout for free.
  - Models write Remotion code reliably.
- **It is generated media, exactly like 3D Studio.**
  - The editor keeps one runtime. The explainer is a video file on the clip.
  - We copy the 3D Studio pipeline piece by piece:
    - `packages/clip-three` → `packages/clip-motion`;
    - `scene_codes` storage by hash (reused);
    - the `generate` task + provider with local and Modal variants (`opencmo/ai/providers/three.py`) → `motion.py`;
    - the `add_3d_studio` op → `add_explainer`;
    - the `preview_3d` → fix → `add_3d_scene` loop → `preview_explainer` → fix → `add_explainer`.
- **The kit carries the quality.**
  - People write and review a small library of beautiful primitives once.
  - The Assistant only composes them. It never picks colours, fonts or easing.
- **The voice is generated inside the render job.**
  - ElevenLabs returns word timings.
  - The composition times every beat and cue from the real words, so sync is right by construction.
  - The voice is muxed into the MP4, so there is one layer and nothing to drift.
  - Previews use estimated timings, which is enough for layout.
- **The Assistant is its own visual critic.** `preview_explainer` returns stills and a layout report. The model
  looks at the images, as it does for `preview_3d`, and fixes them, at most 3 rounds.
- **Not in v1:** music, separate caption layers, a second "director" sub-agent, partial re-render.

## Licence (Track A records the answer here)

- Remotion is free for companies of up to 3 people. The licence does not mention SaaS rendering for customers.
- Ask Remotion in writing before launch. Budget "Automators" pricing: $0.01 per render, $100/month minimum.
- `remotion-dev/skills` has no licence file: read it, never copy its text.
- HyperFrames (Apache-2.0) guidance adapted into the guide needs a `THIRD_PARTY_NOTICES.md` row (Track C).
- **Status: question drafted, not sent yet (pre-launch task, outside this PR).** A cloud session cannot email; the owner sends it from
  their own address and records the answer here. Draft:

  > Subject: Licence for rendering Remotion videos inside a SaaS product
  >
  > We are a company of fewer than 3 people building OpenCMO, a SaaS for solo founders. Our users ask an
  > assistant for a short explainer video; we render it server-side with `@remotion/renderer` (our own
  > compositions, the user never edits Remotion code or sees Remotion Studio) and deliver the MP4 to the user.
  > 1. Is this covered by the free licence while we are 3 people or fewer?
  > 2. If not, or once we grow, is the Automators plan ($0.01 per render, $100/month minimum) the right one,
  >    and does it cover renders on our own servers (Modal), not Remotion Lambda?
  > 3. Is there anything we must show to end users (attribution, terms)?
  >
  > Expected volume at launch: under 1,000 renders a month.
- **Answer:** _pending_.

---

## Contracts (fixed; change only through a Request)

These let the three tracks build against each other from the first hour.

### `MotionJob` (`packages/clip-motion/src/job.ts`, Track A)

```ts
export const FORMATS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] } as const;
export const FPS = 30;
export const MAX_CODE_CHARS = 32_000; // same as scene_codes

export const BeatSchema = z.object({
  say: z.string().trim().min(1).max(240),        // narration for this beat
  label: z.string().trim().max(40).optional(),   // main on-screen words (≤ 5 words, checked by the guide/reviewer)
}).strict();

export const WordSchema = z.object({ text: z.string(), start: z.number().min(0), end: z.number().min(0) }).strict();

export const MotionJobSchema = z.object({
  title: z.string().trim().min(1).max(60),
  code: z.string().min(1).max(MAX_CODE_CHARS),    // TSX written by the Assistant (see "Scene code")
  beats: z.array(BeatSchema).min(3).max(16),
  format: z.enum(['16:9', '9:16', '1:1']),
  duration: z.number().int().min(10).max(90),     // seconds of video
  seed: z.number().int().min(0).max(2_147_483_647).default(0),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), // Brand Kit accent
  words: z.array(WordSchema).optional(),          // real timings; absent = estimated from beats
}).strict();

export type PreviewResult =
  | { ok: true; stills: { t: number; file: string }[]; issues: string[]; estimated: boolean }
  | { ok: false; phase: 'job' | 'compile' | 'guard' | 'render'; message: string };

/** Narration estimate used for `duration` and for previews: 2.4 words/s + 1.5 s tail, rounded up to 5 s. */
export function estimateDuration(beats: Beat[]): number;
```

### CLI (`packages/clip-motion/src/cli.ts`, Track A)

```
clip-motion preview <job.json> <outdir>          → stdout: PreviewResult JSON (stills written to outdir as JPEG, half size)
clip-motion render  <job.json> <out.mp4> [--audio <voice.mp3>]
                                                  → stdout: {"frames":N,"seconds":S,"msPerFrame":M}
```

**Exit codes** (same meaning as `clip-three`):

| Code | Meaning |
|---|---|
| 0 | ok (a preview with layout issues is still 0) |
| 2 | bad arguments |
| 3 | invalid job |
| 4 | the scene code failed (compile, guard or runtime error). Last stderr line = message for the agent; never retried |
| 1 | anything else |

**Environment:**

| Variable | Use |
|---|---|
| `OPENCMO_MOTION_SCALE` | 0.25–1, dev only |
| `OPENCMO_MOTION_CHROME` | browser path |
| `OPENCMO_MOTION_CONCURRENCY` | render concurrency |

### Scene code (what the Assistant writes)

The body of `(React, R, kit) => { …; return function Scene() { … } }`, with JSX allowed.
- `R` is `remotion` (`useCurrentFrame`, `interpolate`, `spring`, `Sequence`, `AbsoluteFill`, …).
- `kit` is the motion kit.
- **No imports.**
- The guard rejects `fetch`, `XMLHttpRequest`, `WebSocket`, `import`, `require`, `eval`, `Function`, `Date`,
  `Math.random`, timers, `document`, `window`, and storage APIs, mirroring `packages/clip-three/src/code/guard.ts`.
- Randomness comes from `kit.random(seed)`.

### Kit API (v1 names; Track A documents it in `packages/clip-motion/README.md`, Track C quotes it in the guide)

- **Layout**
  - `Stage` (theme, field, vignette, grid, bloom; wraps the scene).
  - `kit.area('full' | 'hero' | 'left' | 'right' | 'top' | 'bottom')` returns safe-area boxes for the job's format (top 83%).
- **Text**
  - `Title`
  - `Label({ text, at, swapTo?, swapAt?, strikeAt? })`
  - `Mono` (data text such as `f1 | f2 | gap`)
- **Data and marks**
  - `DotField({ count, seed, area, glow, filterAt?, threshold? })`
  - `Spectrogram`, `Waveform`, `Axes`, `Scatter`, `FitLine`
  - `Link` (draws on between points), `Box` (dashed region), `Counter`, `Check`, `Icon` (small built-in set)
- **Camera:** `Camera({ focus, zoom, at })`.
- **Timing**
  - `kit.beat(i)` returns `{ from, to, frames }`.
  - `kit.cue(i, 'word')` returns the frame of that word in beat `i`.
  - `kit.at(i, 0..1)`.
  - All three resolve from real `words` when present, otherwise from the estimate.
- **Motion**
  - `kit.enter(frame, opts)`, `kit.morph(a, b, progress)` (point sets, start-aligned), `kit.stagger`
  - `kit.ease.out` (power3), `kit.ease.hero` (critically damped spring). No bounce.
- **Colour:** `kit.color.signal | answer | wrong | noise | text | field` (the accent replaces `answer`).
- **Layout report:** primitives tag their boxes. The preview reports:
  - text overlapping text;
  - anything outside the safe area;
  - text under 36 px at 1080 px;
  - a frame that is more than 85% empty.

### Generation spec (Tracks B and C)

- **Model `motion-explainer`** in `packages/contracts/ai-models.json`:
  - `kind: "video"`, `provider: "opencmo-motion"`
  - `limits: { scene: true, aspectRatios: ["16:9","9:16","1:1"], durations: [15,20,25,…,90] }`
  - price per generation, scaled by duration
- **Spec:**

  ```json
  { "aspectRatio": "16:9", "duration": 40, "seed": 0, "voice": "Aria",
    "scene": { "template": "explainer", "code_ref": "<sha256>", "title": "…", "beats": [ … ], "accent": "#…" } }
  ```

  The scene must stay ≤ 4000 bytes, as SQL already enforces for scenes.
- **`apps/web/lib/motion/preview.ts`** (Track B): `previewMotion(job: MotionJob): Promise<PreviewResult & { images?: string[] }>`
  (`images` are base64 JPEGs).
  - Local: spawn the CLI when `OPENCMO_MOTION=local`.
  - Otherwise: POST to `MOTION_PREVIEW_URL` with `OPENCMO_WORKER_TOKEN`.
- **Op `add_explainer`** (Track C, `packages/editor-core`): `{ op, title, format, duration, start?, spec }`.
  - Places one full-frame video layer `Explainer: <title>` from `start` (default: the playhead, or 0 on a blank clip).
  - Sets the project frame on a blank clip.
  - Is one Undo step.

---

## How the three sessions work together

1. **Branch.** Everyone works on `explainer`. Before every task and every push, run
   `git pull --rebase origin explainer`. Never force-push.
2. **Ownership.** Edit only your own files (table below). Need something in another track's file? Add a line
   under [Requests](#requests) and keep going. The owner picks it up.
3. **Contracts first.** Track A's first commit lands `job.ts` and a CLI that renders a placeholder (navy field plus
   the title). Track B's first commit lands `previewMotion` with the local path. Until then, code against the
   contract above.
4. **Small commits:** `explainer A3: DotField with seeded glow`. English only.
5. **Tick your own boxes** and add a line under your Notes in the same commit.
6. **Green before push:** `npm run typecheck` plus your track's checks. A red push blocks the other two.
7. **Verify by looking** (`CLAUDE.md`). Extract frames from full-size renders and look at them. Say in Notes what you checked.
8. **Project rules hold:**
   - every write through ownership-checking RPCs;
   - money only through `credit_hold` / `credit_settle` / `credit_refund`;
   - every migration has a pgTAP test, then run `scripts/dump-schema.sh`;
   - user-facing errors in English;
   - no "coming soon".

| Track | Owns |
|---|---|
| **A: Motion kit & renderer** | `packages/clip-motion/**` (new), root `package.json` (workspace + `check:clip-motion`), `.github/workflows/ci.yml` (add the check), `CLAUDE.md` ("One system" line) |
| **B: Render service & data** | `packages/engine/**`, `packages/contracts/ai-models.json`, `supabase/**`, `apps/web/lib/motion/**` (new), `scripts/dev.mjs`, `.env.example` |
| **C: Assistant & editor** | `apps/web/**` except `apps/web/lib/motion/**`, `packages/editor-core/**`, `THIRD_PARTY_NOTICES.md`, `docs/spec-editor-assistant.md` |

---

## Track A: Motion kit & renderer (`packages/clip-motion`)

Start from `packages/clip-three` (render.ts, cli.ts, code/guard.ts, fonts) and copy its patterns.

- [x] **A1. Package and contract.**
  - Create `packages/clip-motion` with pinned `remotion`, `@remotion/bundler`, `@remotion/renderer`, `react`, `react-dom`, `zod` and `esbuild`.
  - Add `src/job.ts` exactly as in Contracts.
  - Add `src/cli.ts` with `preview` and `render` producing a placeholder (navy field plus title).
  - Add `fixtures/showcase.job.json`.
  - Add the workspace entry and the `check:clip-motion` script.
  - Update the "One system" line in `CLAUDE.md`: generated-media renderers (clip-three, clip-motion) run on the worker; the editor has one runtime.
  - **Push this first.**
- [x] **A2. Compile and guard.**
  - esbuild transforms the TSX body (JSX → `React.createElement`).
  - A static guard plus runtime shims, mirroring clip-three's guard.
  - The code runs only inside the Chromium page.
  - Errors carry phase and message. Exit code 4.
  - Tests: forbidden APIs rejected; syntax errors reported with line numbers.
- [x] **A3. Bundle once, render many.**
  - Bundle the Remotion entry once per process, cached on disk; the agent code arrives through `inputProps`, so there is no rebundle per job.
  - `renderMedia` H.264 at `FPS`, with concurrency from env (default 2).
  - Mux `--audio` with ffmpeg.
  - Chromium runs offline (clip-three `QUIET` flags), with a watchdog per frame.
  - **Measure:** a 60 s render at 1080p, wall time and `/usr/bin/time -v` peak RSS < 2 GB. Write the numbers in Notes.
- [x] **A4. Theme "Blueprint" and the kit primitives** listed in the contract.
  - Fonts bundled from `packages/clip-media/fonts` (DM Serif Display or Fraunces, Source Code Pro).
  - Glow via SVG filters or CSS `drop-shadow`.
  - `DotField` must handle 3,000 dots at 30 fps render speed.
- [x] **A5. Timing.** `beat`, `cue` and `at` from real `words` or from the estimate (`estimateDuration`).
  - Tests: real words map to frames; a missing word falls back to the beat start.
- [x] **A6. Preview and layout report.**
  - `preview` renders 4–6 stills (beat midpoints and the last frame) at half size with `renderStill`.
  - It collects the layout issues from tagged boxes and returns `PreviewResult`.
  - Target: under 15 s warm.
- [x] **A7. Showcase and golden stills.**
  - `fixtures/showcase.job.json`: about 30 s in the reference style, 8 beats (waveform → spectrogram → brightest peaks → pairs → `f1 | f2 | gap` → scatter → line → check).
  - It is written only with the kit, as the Assistant would write it.
  - Golden stills test: PNGs stored, mean-diff threshold as in `editor-parity`.
  - **Look at the frames.**
- [x] **A8. `README.md`** with the kit API, one complete example, and the do/don't list for the guide (Track C copies it).

**Checks:** `npm run check:clip-motion`, `npm run typecheck`, and a showcase render with frames looked at.

**Notes (A):**
- A1: `@opencmo/clip-motion` with Remotion 4.0.530 pinned (all `@remotion/*` must match). `job.ts` is the
  contract verbatim (`estimateDuration` clamps to 15–90 so it is always a valid model duration). The CLI
  renders a real Remotion placeholder already (navy + title): 10 s at 0.5 scale in 25 s cold, 34 ms/frame.
  Bundle is cached on disk under `OPENCMO_MOTION_CACHE` (default `$TMPDIR/opencmo-motion`); fonts come from
  `OPENCMO_EDITOR_FONTS` or `packages/clip-media/fonts`. Needs `ffmpeg` on PATH only for `--audio`.
- A2: `src/code/compile.ts` (esbuild, TSX/TS → `React.createElement`, wrapper `__scene(React, R, kit)`),
  `src/code/guard.ts` (static check on code with strings and comments blanked, so `"Date of birth"` passes)
  and `src/code/run.ts` (in the page: `new Function` with every forbidden global shadowed and a `Math` whose
  `random` throws). Errors are `MotionCodeFailure` with a phase and `Line N:` → exit 4. Runtime errors in the
  scene or kit misuse (`kit.beat(20)`, an unknown colour) also exit 4 with a sentence for the agent, e.g.
  `kit.beat(20): this job has 8 beats (0–7).` Tests: 15 forbidden APIs, syntax line numbers, false positives.
- A3: one webpack bundle per source hash, cached on disk (8–11 s cold, 0 warm); the code goes through
  `inputProps`. Chromium runs through a wrapper script that appends clip-three's QUIET + OFFLINE switches
  (Remotion has no option for extra switches). **GL backend matters**: `swangle` 600 ms/frame, `angle`
  117, `swiftshader` 116 (60–90-frame ranges of the showcase, 4 vCPU, no GPU) → default `angle`, override with
  `OPENCMO_MOTION_GL` (`angle-egl` on a GPU worker). SVG marks are layers only as large as their marks: CSS
  filters cost per layer pixel. **Measured** (`/usr/bin/time -v` plus a PSS sampler over the whole process
  tree, 4 vCPU, concurrency 2): 60 s at 1080p in **3:17**, 109 ms/frame, **peak PSS 1414 MB** for node +
  Chromium + ffmpeg (largest single process 595 MB, the stitcher ffmpeg); showcase 30 s in 1:28, 1407 MB.
  (Summed RSS overstates it at ~2.2 GB because Chromium processes share pages.) `--audio` muxes AAC with an
  explicit demuxer, cut to the video length; checked with a 12 s tone on a 10 s job.
- A4: Blueprint theme (`src/kit/theme.ts`) and primitives in `src/kit/{stage,text,marks,canvas}.tsx`:
  Stage, Camera, Title, Label (swap, strike), Mono (typed), Counter, DotField (canvas, sprite glow, additive,
  4000 max), Spectrogram (+ `kit.spectrogram` data with a spread constellation), Waveform, Axes, Scatter,
  FitLine, Link, Box, Check, Icon (16 names). Fonts: Fraunces (titles), Inter (labels), Source Code Pro (data),
  loaded with `delayRender`. Misuse throws a sentence naming the fix.
- A5: `src/kit/timing.ts`; real words are assigned to beats by word count (whitespace-only words from the
  voice dropped); missing words fall back to the beat start; estimated narration that does not fit the
  duration is compressed. 6 tests.
- A6: `preview` renders beat midpoints (≤ 5) + the last frame at half size in one browser; a probe logs every
  tagged box after camera transforms and `src/layout.ts` reports text over text, safe-area exits (naming the
  caption zone), text under 36 px at 1080 and > 85% empty frames. **3.4 s warm** for 6 stills, 11 s with a
  rebundle. The report caught two real problems in my first showcase (camera push carrying labels out of the
  safe area, an empty ending). stdout is exactly one JSON line (Remotion prints browser logs to stdout, so the
  CLI moves everything else to stderr).
- A7: showcase (`fixtures/showcase.scene.jsx`, embedded by `scripts/build-showcase.ts`): 8 beats, 30 s,
  waveform with noise → spectrogram → brightest peaks → constellation → pairs → `f1 | f2 | gap` → scatter →
  straight teal line + check. Golden stills test: 4 frames at quarter size vs `fixtures/golden/*.png`, mean
  ≤ 1.5 and worst 16×16 tile ≤ 10 (editor-parity measures); CI pins Chrome Headless Shell 1194 like the parity
  job. **Looked at** 6 frames of the full-size MP4 (2.0, 6.5, 11, 15, 21, 29 s): title + kicker over a growing
  gold waveform; spectrogram sweeping in with the 15 peak cells already brighter; peaks flared into a gold
  constellation over the dimmed grid; curved gold links pairing the peaks; axes "time in song / time in clip"
  with yellow points; the matching points turned teal on a glowing line with a teal check and "Song found".
  Also checked 9:16 (kit areas adapt, no layout issues) and fixed what I saw: title over the waveform, waveform
  overlapping the spectrogram sweep, a wrapped x-axis label and a hard-to-read rotated y label.
- A8: `packages/clip-motion/README.md`: CLI, env, scene rules, the kit API, a complete example and the
  do/don't list for the guide.
- A9 moved out of Track A by the owner: the licence question is a pre-launch task, not a blocker for this PR
  (see "Out of scope for v1" and the draft under "Licence").
- For B: the Modal image needs `ffmpeg`, the repo's `packages/clip-motion` + `packages/clip-media/fonts`, and a
  Chrome Headless Shell (`OPENCMO_MOTION_CHROME`); `ensureBrowser()` from `@remotion/renderer` downloads one at build
  time if you prefer. Budget ~3.5 min of 4 vCPU per 60 s video at 1080p on CPU.
- For C: errors on stdout/stderr are written for the agent; quote `README.md` "Kit API" and "Do and don't"
  in the guide.

---

## Track B: Render service & data

Mirror 3D Studio: `opencmo/ai/providers/three.py`, `generate_task.py` (the `code_ref` fetch), `modal_app.py`
(`gpu_image`, `render_three`), and the scene checks in `create_generation`
(`supabase/migrations/20261118090000_chained_shots.sql:122-132`).

- [x] **B1. `apps/web/lib/motion/preview.ts`.**
  - `previewMotion` implemented exactly as in Contracts.
  - Local path: spawn the CLI in a temp dir, read the JPEGs as base64, clean up.
  - Modal path: POST with a token.
  - Timeout 60 s, then an English error.
  - **Push early** (Track C uses it).
- [x] **B2. Model and SQL.**
  - Add `motion-explainer` to `ai-models.json`.
  - Price: start at 1 credit per 10 s plus the voice (5 per 1,000 characters), rounded up. Adjust after B6's measurements.
  - Migration:
    - `create_generation` checks `code_ref` for `template = 'explainer'` as it already does for `'code'`;
    - duration must be in `limits.durations`;
    - the scene stays ≤ 4000 bytes.
  - A pgTAP test, `scripts/dump-schema.sh`, and `npm run check:contracts --workspace @opencmo/web`.
- [x] **B3. Provider `opencmo-motion`** (`opencmo/ai/providers/motion.py`, registered in `providers/__init__.py`).
  1. Load the code by `scene.code_ref`, as `generate_task.py:254` does.
  2. Get the voice:
     - **Real:** ElevenLabs through the fal speech path (`speech_payload`, `speech_words`). Narration = the beats' `say` joined with spaces; premade voices only.
     - **Fake (`OPENCMO_MOTION_FAKE_VOICE=1`):** a silent track plus estimated words.
  3. Write `job.json` with the real `words`.
  4. Run `clip-motion render --audio`. If the narration is longer than `duration`, clip it to `duration` and log it.
  5. Return the video.
  - Errors: exit code 4 → `"The explainer code failed: …. Your credits were refunded."`, never retried.
  - Variants `OPENCMO_MOTION=local` (CLI on this machine) and `modal`.
- [ ] **B4. Modal.**
  - A CPU image `motion_image`: Node, `packages/clip-motion`, Remotion's headless Chrome installed at build time, the bundle pre-built.
  - `render_motion(payload) -> bytes`, with cpu 4 and memory 4096 like `render_three`, and no secrets.
  - A web endpoint `motion_preview` (token auth like `submit`) that returns PreviewResult with base64 stills.
- [x] **B5. Dev experience.**
  - `scripts/dev.mjs` and `.env.example` default to `OPENCMO_MOTION=local`, plus `OPENCMO_MOTION_FAKE_VOICE=1` when there is no fal key.
  - A first run downloads Remotion's browser once.
  - Document it in `.env.example`.
- [ ] **B6. Measure on Modal.**
  - Deploy, then render the showcase and a 60 s job.
  - Record time, cost per video and cold start.
  - Set the price in `ai-models.json` with margin. Write the numbers in Notes.

**Checks:**
- `cd packages/engine && .venv312/bin/python -m pytest -q && .venv312/bin/python -m ruff check .`
- `npm run db:reset && npm run db:test`
- `npm run typecheck`
- One local render through the worker: a task in the DB, then an MP4 in Storage.

**Notes (B):**
- B1: `previewMotion(job, { timeoutMs? })`. Local spawns `node packages/clip-motion/src/cli.ts preview` with a
  minimal env (the server's keys stay out, and its `NODE_OPTIONS=--conditions=react-server` broke Remotion);
  returns `{ ok: false }` for job/code errors (the Assistant fixes those) and throws an English error on a
  timeout or outage. `stills[].file` comes back as a bare file name; a still outside the temp folder is refused.
  Checked by `lib/motion/preview.check.ts` (fake CLIs + a local HTTP server) and against A's real CLI.
- B2: price `{ "unit": "explainer", "credits": 1, "voiceKchars": 5 }` = `credits × ceil(duration / 10)` +
  `voiceKchars × max(1, ceil(narration chars / 1000))`, narration = beats' `say` trimmed and joined with one
  space. Integer on purpose: `0.1 × 30` is `3.0000000000000004` in JS (ceil → 4) but 3 in SQL, and Python read
  `int(0.1)` as 0. A 20 s, short script costs 7; 90 s with 1,205 characters costs 19. Provisional until B6.
  `maxPromptChars: 80` for `"Explainer: <title>"`. Migration `20261124090000_motion_explainer.sql`:
  `ai_check_spec` takes `voice` on video models with `limits.voices`, ties `template = 'explainer'` to the
  `opencmo-motion` provider both ways, checks `code_ref` against the caller's `scene_codes` and the script
  (title, 3–16 beats, `say` ≤ 240, `label` ≤ 40, accent); `ai_price` gains the unit; `agent_raise_hold_3d`
  counts `preview_explainer`. pgTAP `154_motion_explainer` (22 tests); full suite 1398/1398. Schema dumped.
- B3: `opencmo/ai/providers/motion.py`. Voice through `FalProvider` + `elevenlabs-voice` (premade names);
  narration longer than `duration` is cut with ffmpeg and words past the end dropped (logged). Fake voice =
  silent AAC of `duration` seconds and no `words`, so the renderer estimates. Exit 4 →
  `The explainer code failed: …. Your credits were refunded.`, exit 3 → invalid, both never retried. The CLI
  gets a minimal env. Moderation skips `opencmo-motion` like 3D (text is checked on the web, C3).
  `adapter_for` needs `OPENCMO_MOTION=local|modal` plus a fal key or the fake voice (never in production);
  with neither renderer, `OPENCMO_AI_FAKE=1` falls back to the fake model.
  **Verified through the worker:** a `motion-explainer` generation created by `create_generation` on local
  Supabase, picked up by `python -m opencmo.worker` (`OPENCMO_MOTION=local`, fake voice, scale 0.5): task
  `done`, 7 credits settled, MP4 in `media` (540×960, 15 s, H.264 + AAC). Frame at 5 s looked at: A1's
  placeholder (navy + title). 16:9 run directly: 25.6 s cold for 15 s, peak child RSS ~725 MB
  (`getrusage`; `/usr/bin/time` is not installed here). For A: in 9:16 the placeholder title touches the left edge.
- B4: written, **not built or deployed** (no Modal credentials in this session). `motion_image` (CPU: Node,
  Remotion's libs, `npm install` of clip-motion, `ensureBrowser()` then the shell pinned as
  `OPENCMO_MOTION_CHROME` so the CLI's offline flags apply, bundle warmed by rendering
  `fixtures/placeholder.job.json` at build), `render_motion` (cpu 4, 4 GB, no secrets, `{job, audio}` → bytes;
  the worker makes the voice first and spawns it), and `motion_preview` (token in the body like `submit`). The
  preview container gets a new token-only secret, never `opencmo` with the service key:
  `modal secret create opencmo-motion OPENCMO_WORKER_TOKEN=...`. The worker image sets `OPENCMO_MOTION=modal`.
- B5: `npm run dev` passes `OPENCMO_MOTION=local` to web and worker, and `OPENCMO_MOTION_FAKE_VOICE=1` when
  no `FAL_KEY` is set; `.env.local` values win. Documented in `apps/web/.env.example`.
- B6: blocked here (needs Modal access): deploy, render the showcase and a 60 s job, then set the price.

---

## Track C: Assistant & editor

Mirror 3D Studio:
- `packages/editor-core/src/ops/studio3d.ts` (`add_3d_studio`);
- `apps/web/lib/agent/generate-tool.ts` (`prepareScene`, `prepareStudio`, `generateCard`);
- the `preview_3d` loop and the `"3d"` guide in `guides.ts`.

- [x] **C1. Op `add_explainer`** in `packages/editor-core/src/ops/` with zod input.
  - Places the generated video layer.
  - Sets the frame on a blank clip.
  - `agent: false`.
  - Tests in the style of `studio3d` tests.
- [x] **C2. Tool `preview_explainer`** (server tool, not a browser tool).
  - Input: `{ title, beats, code, format }`.
  - Builds a `MotionJob` with `estimateDuration` and calls `previewMotion` (Track B).
  - Returns the stills as images plus the issues, so the model sees them.
  - Counts as a slow plan.
- [x] **C3. Tool `add_explainer`** (approval).
  - Input: `{ title, beats, code, format, voice }`.
  - Saves the code with `save_scene_code`, builds the spec, prices it, and returns a card listing the beats (Beat / Voice / On screen), the voice name and the credits.
  - Moderation runs on every string literal in the code (like `codeGlyphs`) plus the narration, through `moderateText`.
  - Refuse when the code was not previewed in this turn, as `add_3d_scene` does.
- [x] **C4. Guide `explainer`** (`read_guide "explainer"`).
  - **Script rules.** Adapted from HyperFrames story design; add the `THIRD_PARTY_NOTICES.md` row.
    - one of 4 structures; a hook in the first beat;
    - 6–20 words per beat; labels ≤ 5 words;
    - each beat transforms what is on screen.
  - **The kit API.** From Track A's README.
  - **The loop:**
    1. show the script and ask;
    2. write the code;
    3. `preview_explainer`;
    4. fix up to 3 rounds;
    5. `add_explainer`.
  - Slash `/explain` in `slash.ts`. Mention it in `prompt.ts`.
- [x] **C5. Register the routes** everywhere they are listed:
  - `SLOW_PLANS` in `limits.ts`
  - `providers/anthropic.ts`
  - `providers.check.ts`
  - `agent-design.check.ts`
  - `providers/fake.ts` (a scripted `/explain` that uses the showcase code)
  - `eval/tasks.ts` (2 tasks)
  - `docs/spec-editor-assistant.md` §4–§5
- [x] **C6. Editor UX.**
  - The layer shows render progress and failure like other generated media.
  - An "Explain a concept" entry on the New edit screen opens the Assistant with `/explain `.
  - Ctrl+Z removes the layer. Export includes it.
- [x] **C7. E2E `apps/web/e2e/editor-explainer.spec.ts`.**
  - Fake agent, `OPENCMO_MOTION=local`, fake voice.
  - Steps: `/explain` → script → go → preview images visible → approve → the layer appears → render finishes → the playhead at 2 s shows non-empty pixels.
  - Add it to CI if the runtime allows; otherwise say why in Notes.

**Checks:**
- `npm run typecheck`, `npm run check:editor-core`, `npm run check:contracts --workspace @opencmo/web`
- `cd apps/web && npm run test:e2e -- editor-explainer`

**Notes (C):**
- C1: `packages/editor-core/src/ops/explainer.ts` (op) and `src/explainer.ts` (scene schema, `estimateDuration`, `explainerSeconds`; no Remotion dependency in editor-core, same formula as `clip-motion/src/job.ts`). `specSchema` takes the explainer scene (≤ 4000 bytes) and a premade `voice` for `provider: "opencmo-motion"`; `priceOf` adds `price.voiceKchars` per started 1,000 narration characters. `src/explainer.test.ts`: blank clip (frame + work area), playhead start under text, other format letterboxed, spec mismatch refused, timing, price. `npm run check:editor-core` and vitest green (584 tests).
- C2–C6 (`apps/web/lib/agent/explainer-tool.ts`, wired in `scope.ts`, `eval/run.ts`): `preview_explainer` is a server tool in `SLOW_PLANS`; its stills reach the model as images (`ToolOutcome.images`) and the panel over SSE (not stored). `add_explainer` refuses code not previewed in the same turn, saves it with `save_scene_code`, prices the spec and shows one card line per beat; moderation reads the script plus every string literal and JSX text of the code. Guide `explainer`, `/explain`, prompt routing, `ALWAYS_LOADED`, `PRICED`, both checks, fake provider (`/explain` → script → "go" → preview → card, with `fixtures/showcase.job.json`), two eval tasks (`explain-script`, `explain-make`), spec §4–§5, `THIRD_PARTY_NOTICES.md` + `LICENSE-hyperframes.md`. Editor: "Rendering explainer…" on the layer, no Regenerate (same picture, paid again), "Explain a concept" starter on a blank New edit (opens `/explain `), the editor sends `voice` in the resolved spec.
- Verified with Track B's pieces stubbed locally (not committed: a `previewMotion` that returns one still, and a `motion-explainer` catalog entry as in Requests): `tsc` for web, `npm run check:contracts` (providers, agent-design, video-usecases… all green), `next build` green, the fake provider's three turns, and prepare → card → op on a blank clip (frame 1920×1080, work area 0–15, one layer `Explainer: …`).
- C2–C7 were held on `explainer-track-c` until B1 and B2 landed (they import them), then cherry-picked here.
- B's requests done: `priceOf` has the integer unit `explainer` (credits × started 10 s) and counts narration in code points; `providerEnabled` uses the worker's rule (renderer + fal key or fake voice, or `aiFakeEnabled`); `@opencmo/clip-motion` is a web dependency and `lib/motion/preview.check.ts` runs in `check:contracts`. Real round trip checked: `runPreviewExplainer` → `previewMotion` → A's CLI with `fixtures/showcase.job.json`; A's `previewJob` is still a stub (no stills), which the tool reports as "No stills came back." until A6.
- C7: **`npm run test:e2e -- editor-explainer` passes** (5.2 min, real stack: local Supabase, the Python e2e worker with `OPENCMO_MOTION=local` + fake voice, A's kit and B's provider, no stubs). New edit → "Explain a concept" → `/explain …` → script → "go" → 6 preview stills in the panel → card (35 s · 16:9 · voice Aria · 9 credits, one line per beat) → Approve → one layer `Explainer: How Shazam hears a song`, frame 1920×1080 → render done → the full-size MP4 is 1920×1080 with an audio track and its 2 s frame has the title and waveform → the editor at playhead 0:02 shows the same frame → Ctrl+Z removes the layer. **Looked at** the 2 s frame of the MP4 (kicker "IN A NOISY BAR", serif title, gold waveform on the navy grid), the card and the editor screenshot. Two bugs found by the run and fixed: the fake agent read a result with stills as `{}`, and the first pixel bar (std > 2) passed on the bare navy field of frame 0, so the editor check now needs the title (std > 12; the MP4 frame is 24).
- C7 is not in CI: CI has no e2e job at all (it needs Docker Supabase, the engine venv with MediaPipe, and a Chrome that plays H.264; the bundled Chromium cannot, and the editor refuses to open there). To run it: `E2E_EXECUTABLE=<Chrome or Chrome for Testing> npm run test:e2e -- editor-explainer` in `apps/web` (`E2E_CHANNEL=chromium` skips only the editor pixel check).

---

## Requests

Cross-track asks. Format: `- [ ] (from X → owner Y) what and why`. The owner ticks it when done.

- [x] (from C → owner B) `motion-explainer` in `ai-models.json` needs `limits.voices` (premade voices; the tool lists them and `specSchema` checks them) and the price as `{ "unit": "second", "credits": 0.1, "voiceKchars": 5 }`. `priceOf` (editor-core) already adds `voiceKchars × ceil(narration chars / 1000)`, narration = beats' `say` joined with spaces; `ai_price` (SQL) must do the same.
- [x] (from C → owner B) The spec C sends: `{ prompt: "Explainer: <title>", aspectRatio, duration, voice, seed, scene: { template: "explainer", code_ref, title, beats, accent? } }`. `create_generation` must accept `voice` on this video model and check `code_ref` for `template = 'explainer'`.
- [x] (from C → owner B) `agent_raise_hold_3d` counts only `preview_3d`: count `preview_explainer` too, so an explainer turn gets the bigger hold.
- [x] (from C → owner B) With `OPENCMO_AI_FAKE=1` and `OPENCMO_MOTION=local` (the e2e env, `apps/web/e2e/run.ts`), the worker must render `motion-explainer` with the local CLI, not the fake colour frame: the e2e checks real pixels.
  - B: done, but with an integer price unit (see Notes B2 for why): `{ "unit": "explainer", "credits": 1, "voiceKchars": 5 }`. See the request to C below.
  - B: `maxPromptChars` is 80 so `"Explainer: <title>"` fits.
  - B: `OPENCMO_MOTION=local` wins over `OPENCMO_AI_FAKE`. The voice also needs `OPENCMO_MOTION_FAKE_VOICE=1` (or `FAL_KEY`): add it to `apps/web/e2e/run.ts` for the worker.
- [x] (from C → owner A) The guide `explainer` quotes the kit API from Contracts. Tell C when the README (A8) changes a name; the fake provider plays `fixtures/showcase.job.json` as is, so it must stay a valid, kit-only job.
  - A: no contract name changed. The showcase stays a valid kit-only job (the golden test checks it). What the
    guide is missing (the agent will otherwise hit kit errors): see the request to C below.
- [x] (from A → owner C) Add to guide `explainer` §2, from `packages/clip-motion/README.md` "Kit API":
  `Spectrogram` needs `data={kit.spectrogram(seed, { cols, rows, peaks })}` and its `data.peaks[i].x/y` are
  placed with `kit.place(area, [x, y])`; `Scatter` needs `points` (`kit.trend(seed, { n, slope, spread })`) and
  `FitLine` takes `from`/`to` in data units (0..1, y up) of the same `area` as `Axes`; `Link` takes pixels;
  `Label`/`Mono` take `x`, `y` (pixels) or `area`; every component takes `at`, `exitAt`; Camera is
  `keys={[{ at, focus: [x, y], zoom }]}`; **keep text outside `Camera`**; colours also include `dim`; `kit.width`,
  `kit.height`, `kit.portrait`. Paste the "Do and don't" list too (it is written for the guide).
- [x] (from B → owner C) `priceOf` (editor-core): add `case 'explainer': return model.price.credits * Math.ceil((spec.duration ?? 0) / 10);` and `'explainer'` to the `unit` union; the `voiceKchars` addition stays as it is. Until then `priceOf` returns `NaN` for this model. Also count narration in code points (`[...text].length`), as SQL `length()` and Python `len()` do.
- [x] (from B → owner C) `providerEnabled` in `apps/web/lib/generate/models.ts`: `opencmo-motion` is on when `OPENCMO_MOTION` is `local` or `modal` and (`FAL_KEY` or `OPENCMO_MOTION_FAKE_VOICE=1` outside production), or `aiFakeEnabled()`, the same rule as `adapter_for`. Until then the web hides the model.
- [x] (from B → owner C) In `apps/web/package.json`: add `"@opencmo/clip-motion": "*"` (`lib/motion/preview.ts` imports its types) and `NODE_OPTIONS=--conditions=react-server tsx lib/motion/preview.check.ts` to `check:contracts`.

---

## Out of scope for v1

- **Remotion licence answer (was A9).** Before launch, the owner sends the drafted question under "Licence"
  and records the answer there. It does not block this PR.

Music bed, separate editable caption layers, re-rendering a single beat, a second "director" sub-agent, a vision
critic other than the Assistant itself, and landing-page copy (only after the deployed test passes).
