# Motion quality: spec with numbers, a real review loop, real images, templates and short silent clips

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Two sessions build it in parallel: read [`2026-10-22-motion-quality-sessions.md`](2026-10-22-motion-quality-sessions.md)
> for who owns what.

**Goal:** Make the motion the editor produces (explainers today, short silent motion pieces next) look like the
Opus remakes and Claude Design output, for both the editor Assistant and Claude over MCP.

**Architecture:** Keep one runtime (`clip-motion`, Remotion, scene code as the body of `(React, R, kit) => …`). Add
what the research says made the difference: a required numeric motion spec (`direction`) before code, previews at
times the model picks plus a one-frame "jump" check and a review checklist (up to 6 rounds), the user's own images
in scenes (`kit.Image`, same ownership path as generation references), a template library ported from Opus's MIT
remakes, and a silent `clip` kind (3–30 s) for intros and product moments. Every tool change lives in
`apps/web/lib/agent/explainer-tool.ts`, which the MCP server already reuses through `packages/mcp-server/src/groups/studio.ts`.

**Priority (owner, 2026-10-22):** Claude over MCP first. Every task must work end to end from an MCP client; the
in-app Assistant gets the same tools for free but is checked second. Which model writes the code does not matter for
now.

**Tech Stack:** TypeScript (Next.js app, `clip-motion` on Remotion 4.0.535, zod 4, vitest, `tsx` check scripts),
Python worker (`packages/engine`, pytest), Supabase SQL + pgTAP, Modal.

**Spec:** [`docs/research/editor/2026-10-22-motion-quality-opus-claude-design.md`](../../research/editor/2026-10-22-motion-quality-opus-claude-design.md)
(the research report; recommendations 1–3 are in scope, 4 is decided after Task A0).

## Global Constraints

- One runtime: scene code still runs only in `clip-motion` on the worker or the preview container; Chromium stays offline (`CHROMIUM` flags in `packages/clip-motion/src/render.ts`). No new renderer.
- The scene sandbox keeps `R.Img`, `staticFile`, `fetch` and `import` forbidden (`packages/clip-motion/src/code/guard.ts`); images reach scenes only through `kit.Image` reading `job.assets`.
- Images in a scene are the user's own library media: a `media` bucket object under `<user_id>/`, checked by `public.ai_media_ref_ok` in SQL and re-checked against the task owner in the worker.
- Copy only from `opus-pro/opusclip-video-tools/remakes/**` (MIT, notice in `THIRD_PARTY_NOTICES.md`). Never copy its media, nor text from `plugins/**` (no licence) or the leaked Claude Design prompt: learn the idea, write our own words.
- Copy describes software; no model names as features; no "coming soon" (CLAUDE.md product rules).
- Everything in English, including SQL `raise exception` text and tool descriptions (they reach the user and MCP clients verbatim).
- Hard budget: peak RAM per job < 2 GB; measure the render of the longest new job with `/usr/bin/time -v` (or `RUSAGE_CHILDREN` where `time` is missing).
- Migrations: every new one gets a pgTAP test in `supabase/tests/`; regenerate `supabase/schema/current.sql` with `scripts/dump-schema.sh`; never edit a merged migration.
- New `opencmo-motion` env key `OPENCMO_MOTION_ASSET_ORIGIN` must be added to `packages/engine/opencmo/deploy_env.py` (plain value, shared with the worker's `SUPABASE_URL`).
- Values pinned by this plan: `direction` 120–3000 chars; `times` ≤ 12 values; ≤ 6 assets per scene, asset names `^[a-z][a-z0-9-]{0,31}$`, ≤ 2,000,000 bytes and ≤ 4096 px per edge; preview rounds up to 6; MCP previews 60 per hour; `clip` 3–30 s with 1–8 beats, each beat 0.5–30 s.

## Review Focus

1. **An MCP client written against today's schema** (no `direction`) calls `preview_explainer` → it gets one clear validation message naming `direction` and what to write, not a crash. Test in A3.
2. **A media path of another user, or a `..` path, in `assets`** → refused in the tool before any preview, refused again by SQL at `create_generation`, and by the worker against the task owner. Tests in A5 (tool + pgTAP) and A4 (worker).
3. **An asset URL outside the allowed origin, a non-image body, or a 30 MB image** at preview → the preview returns `{ ok: false, phase: "job" }` with a message the model can act on; Chromium never fetches anything. Test in A4.
4. **`times` past the end of the video, negative, or duplicated** → clamped to the last frame, deduplicated, sorted; never a render error. Test in A2.
5. **A silent clip whose beat seconds add up to more than 30 s, or a narrated explainer passed `silent: true` with a voice** → refused with the rule in one sentence before any credit is held; SQL refuses the same spec if it is sent directly. Tests in B1 (pgTAP) and B4.

---

## Session A — spec, review loop, real images

### Task A0: Baseline frames before any change

No code. Records what "before" looks like, so A6 and B7 compare against something real.

**Files:**
- Create: `docs/plans/editor/2026-10-22-motion-quality-frames/baseline/` (PNG/JPEG stills + `README.md`)

- [ ] **Step 1:** In a local stack (`npm run dev`), run both briefs through Claude Code connected to the local MCP server, each on a blank 16:9 New edit (`create_edit`). Briefs (use verbatim):
  - Brief 1: `/explain How OpenCMO turns one long video into a week of clips: upload, cut by words, add B-roll, export.`
  - Brief 2: `Make a 20 s explainer: "Three things a solo founder should automate first", one beat per thing, end on a checklist.`
- [ ] **Step 2:** Save the last clean preview's stills of each run plus one full-size frame from the middle of each rendered layer (`ffmpeg -ss <mid> -i <file> -frames:v 1`) into the folder; in `README.md` note per run: model, rounds used, minutes, and three things that look worst.
- [ ] **Step 3:** Commit `[A] Motion quality: baseline frames` (frames + README only).

### Task A1: Shared contracts (lands first; both sessions code against it)

**Files:**
- Modify: `packages/clip-motion/src/job.ts`
- Modify: `packages/editor-core/src/explainer.ts`
- Test: `packages/clip-motion/src/job.test.ts`, `packages/editor-core/src/explainer.test.ts`

**Interfaces:**
- Produces (`packages/clip-motion/src/job.ts`):
  ```ts
  export const MOTION_KINDS = ['explainer', 'clip'] as const;
  export const ASSET_NAME = /^[a-z][a-z0-9-]{0,31}$/;
  export const MAX_ASSETS = 6;
  export const MAX_ASSET_BYTES = 2_000_000;
  export const MAX_ASSET_EDGE = 4096;
  export const MAX_PREVIEW_STILLS = 12;
  export const CLIP_SECONDS = { min: 3, max: 30 } as const;
  export const AssetSchema: z.ZodObject<{ name; src: string /* data:image/(png|jpeg|webp);base64,… or https://… */; width?: number; height?: number }>;
  // BeatSchema += seconds?: number (0.5–30)
  // MotionJobSchema += kind?: 'explainer' | 'clip' (absent = explainer); stills?: number[] (≤ 12, seconds ≥ 0, preview only);
  //                    assets?: Asset[] (≤ 6, unique names)
  // Refinement: explainer → beats 3–16, duration 10–90; clip → beats 1–8, every beat has seconds,
  //             duration 3–30 and ≥ the sum of beat seconds.
  export type MotionAsset = z.infer<typeof AssetSchema>;
  ```
- Produces (`packages/editor-core/src/explainer.ts`):
  ```ts
  export const MOTION_CLIP_MODEL = 'motion-clip';
  export const MotionAssetRefSchema: z.ZodObject<{ name: string /* ASSET_NAME */; ref: string /* media object path, ≤ 500 */ }>;
  // ExplainerSceneSchema += assets?: MotionAssetRef[] (≤ 6)
  export const ClipBeatSchema: z.ZodObject<{ say: string /* 1–240, storyboard only, not voiced */; label?: string; seconds: number /* 0.5–30 */ }>;
  export const ClipSceneSchema: z.ZodObject<{ template: 'clip'; code_ref; title; beats: ClipBeat[] /* 1–8 */; accent?; theme?; personality?; assets? }>;
  export const clipSeconds: (beats: readonly ClipBeat[]) => number; // ceil(sum), clamped 3–30
  ```

- [ ] **Step 1: Write the failing tests** in `job.test.ts`: `accepts a silent clip of 3 s with one timed beat`; `refuses a clip beat without seconds` (issue path `beats.0.seconds`); `refuses a clip whose beats add up past its duration`; `refuses 7 assets`; `refuses two assets named "logo"`; `refuses an asset name "Logo"`; `keeps an explainer without kind valid as today` (the existing golden job parses unchanged); `refuses 13 preview stills`. In `explainer.test.ts`: `clipSeconds rounds 3.2 s up to 4 and clamps 40 s to 30`; `ClipSceneSchema refuses 9 beats`; `ExplainerSceneSchema accepts assets with a media path`.
- [ ] **Step 2:** Run `npm run check:clip-motion && npm run test:editor-core` → the new tests FAIL.
- [ ] **Step 3:** Implement the schemas above. The `superRefine` on `MotionJobSchema` carries the per-kind rules; `BeatSchema.seconds` is optional so explainer beats stay valid.
- [ ] **Step 4:** Run the same commands → PASS; `npm run typecheck` passes.
- [ ] **Step 5:** Commit `[A] Motion jobs: clip kind, preview times and image assets in the contract`.

### Task A2: Preview at chosen times, and a jump check

**Files:**
- Modify: `packages/clip-motion/src/preview.ts`, `packages/clip-motion/src/kit/timing.ts`, `packages/clip-motion/src/layout.ts`
- Test: `packages/clip-motion/src/kit/timing.test.ts`, `packages/clip-motion/src/layout.test.ts`

**Interfaces:**
- Consumes: `MotionJob.stills`, `MAX_PREVIEW_STILLS` (A1).
- Produces:
  ```ts
  // kit/timing.ts
  export function previewFrames(timeline: Timeline, times?: readonly number[]): number[]; // times → frames; default = stillFrames(timeline)
  export function pairedProbes(timeline: Timeline): { beat: number; frame: number }[]; // probeFrames + the frame after each
  // layout.ts
  export function jumpIssues(pairs: { seconds: number; a: LaidBox[]; b: LaidBox[] }[], frame: { width: number; height: number }): string[];
  ```

- [ ] **Step 1: Write the failing tests:** `previewFrames maps 1.5 s to frame 45`; `previewFrames clamps 999 s to the last frame, drops negatives, dedupes and sorts`; `previewFrames without times equals stillFrames`; `jumpIssues reports a box that moves 300 px in one frame on a 1080 frame` (message contains the box name, `jumps`, and the time); `jumpIssues ignores a box that appears or disappears`; `jumpIssues ignores a 20 px move`.
- [ ] **Step 2:** Run `npm run check:clip-motion` → FAIL.
- [ ] **Step 3:** Implement. Jump threshold: centre moves more than 12% of the frame's short side between two consecutive frames (one frame at 30 fps), matched by `kind` + `name`. In `previewJob`, render stills at `previewFrames(timeline, job.stills)` and probes at `pairedProbes(timeline)`; add `jumpIssues` to `issues`. Message: `"<name>" jumps <px> px in one frame at <t> s: ease the move or cut on purpose.`
- [ ] **Step 4:** Run `npm run check:clip-motion` → PASS, including `golden.test.ts` unchanged.
- [ ] **Step 5:** Commit `[A] Motion preview: stills at chosen times; flag one-frame jumps`.

### Task A3: `direction`, `times` and the review checklist in the tools and guides

**Files:**
- Modify: `apps/web/lib/agent/explainer-tool.ts`, `apps/web/lib/agent/motion-guide.ts`, `apps/web/lib/agent/guides.ts` (guide `explainer`)
- Modify: `packages/mcp-server/src/groups/studio.ts` (`PREVIEW_LIMIT` 30 → 60), `packages/mcp-server/src/groups/guides.ts` (workflow line: direction, up to 6 rounds)
- Test: `apps/web/lib/agent/explainer-tool.check.ts`, `apps/web/lib/agent/agent-design.check.ts`, `packages/mcp-server/src/server.check.ts`

**Interfaces:**
- Consumes: `MotionJob.stills` (A1), `previewFrames` behaviour (A2).
- Produces (`explainer-tool.ts`):
  ```ts
  // sceneFields += direction: string (120–3000), declared BEFORE `code` so models write it first
  // previewExplainerInput += times?: number[] (≤ 12)  → previewJob(...).stills
  export const DIRECTION_HELP: string;   // what a direction must contain (used in the field description and the guide)
  export const REVIEW_CHECKLIST: string; // returned with every ok preview, answered line by line before add_explainer
  export const PREVIEW_ROUNDS = 6;
  ```

- [ ] **Step 1: Write the failing checks** in `explainer-tool.check.ts`: a preview without `direction` returns `ok: false` whose content names `direction`; a 119-char direction is refused; `times: [2, 2, 99]` reaches the fake `preview` as `stills: [2, 2, 99]` (dedupe/clamp happen in clip-motion); an ok preview's content contains `REVIEW_CHECKLIST` and the round limit `6`; the JSON schema of `preview_explainer` lists `direction` before `code`. In `server.check.ts`: the MCP `preview_explainer` input schema requires `direction`.
- [ ] **Step 2:** Run `cd apps/web && npm run check:contracts` and `npm run check:mcp-server` → FAIL.
- [ ] **Step 3:** Implement. Write `DIRECTION_HELP` and `REVIEW_CHECKLIST` in our own words from the research report's findings (one visual centre per beat; no slide layouts or parallel cards; for every move: what, from → to in px or % of the frame, start and end in seconds, curve; reveal order; what stays alive; the bar: crisp resting text, nothing clipped or overlapping). `REVIEW_CHECKLIST` ends: "Name the one worst problem you see, fix only that, and preview again; stop when a round finds nothing." Rewrite `EXPLAINER_MOTION` and the guide's preview steps to: storyboard → direction → code → preview (pick `times` around every main move) → checklist → up to 6 rounds. Update the `preview_explainer` description to match (no "up to 3 rounds" left anywhere: `rg "3 rounds" apps packages` is empty).
- [ ] **Step 4:** Run the two commands → PASS; `npm run typecheck` passes; `cd apps/web && npm run agent:eval -- --provider fake` still passes its explainer task.
- [ ] **Step 5:** Commit `[A] Explainers: a numeric direction first, previews at chosen times, a review checklist`.

### Task A4: Images in scenes (`kit.Image`) and safe inlining

**Files:**
- Create: `packages/clip-motion/src/assets-inline.ts`, `packages/clip-motion/src/kit/image.tsx`
- Modify: `packages/clip-motion/src/errors.ts` (phase `job`), `packages/engine/.env.example` and `apps/web/.env.example` (document `OPENCMO_MOTION_ASSET_ORIGIN` for `OPENCMO_MOTION=local`)
- Modify: `packages/clip-motion/src/kit/index.ts` (add `Image`, `images`), `packages/clip-motion/src/preview.ts` and `packages/clip-motion/src/render.ts` (inline before `prepare`), `packages/clip-motion/src/layout.ts` (image boxes count as marks)
- Modify: `packages/engine/opencmo/ai/providers/motion.py` (`motion_job` builds `assets` from `scene.assets`), `packages/engine/opencmo/deploy_env.py` (`OPENCMO_MOTION_ASSET_ORIGIN` in `opencmo-motion`, equal to the worker's `SUPABASE_URL`)
- Test: `packages/clip-motion/src/assets-inline.test.ts`, `packages/clip-motion/src/golden.test.ts`, `packages/engine/tests/test_ai_motion_provider.py`, `packages/engine/tests/test_check_deploy_env.py`

**Interfaces:**
- Consumes: `AssetSchema`, limits (A1).
- Produces:
  ```ts
  // assets-inline.ts — runs in Node before Chromium; the only place that fetches.
  export async function inlineAssets(job: MotionJob, options: { origin: string | undefined; fetch?: typeof fetch }): Promise<MotionJob>;
  // throws MotionCodeFailure(message, 'job') on: origin mismatch, non-2xx, > MAX_ASSET_BYTES, magic bytes not PNG/JPEG/WebP
  // (errors.ts: add 'job' to MotionCodeFailure's phases; preview.ts already maps the phase into { ok: false })
  // kit.Image props: { name: string; x: number; y: number; w: number; h: number; fit?: 'cover' | 'contain'; radius?: number; style?: React.CSSProperties }
  // kit.images: readonly string[]  (asset names of this job)
  ```
  ```python
  # motion.py
  def motion_assets(store, task, scene: dict, workdir: Path) -> list[dict]:  # [{name, src: data URI, width, height}]
  ```

- [ ] **Step 1: Write the failing tests:** `assets-inline.test.ts`: `inlines a PNG from the allowed origin as a data URI`; `refuses another origin` (message names the origin rule); `refuses a 2,000,001-byte body`; `refuses an HTML body served as image/png`; `leaves data URIs untouched`. `golden.test.ts`: a scene using `<kit.Image name="shot">` with a 1×1 PNG data URI renders a still, and `<kit.Image name="nope">` fails with `kitError` naming the available images. Python: `test_motion_assets_refuse_another_users_path`, `test_motion_assets_keep_transparency_as_png` (a logo with alpha stays PNG with alpha), `test_motion_assets_without_alpha_become_jpeg_under_2048_px` (reuse the `image2pipe` re-encode from `generate_task.py`; extract it to a shared helper rather than copying). Deploy env: `test_motion_asset_origin_must_equal_the_worker_supabase_url`.
- [ ] **Step 2:** Run `npm run check:clip-motion` and `cd packages/engine && .venv312/bin/python -m pytest -q tests/test_ai_motion_provider.py tests/test_check_deploy_env.py` → FAIL.
- [ ] **Step 3:** Implement. `inlineAssets` origin comes from `OPENCMO_MOTION_ASSET_ORIGIN` (CLI and serve read it once). The worker turns each `{name, ref}` into a re-encoded data URI (PNG when the source has alpha, so logos keep their transparency; JPEG otherwise; longest edge ≤ 2048 px), so final renders never fetch; previews carry signed `https` URLs that `inlineAssets` fetches. `kit.Image` draws an `<img>` with the data URI (allowed: it is kit code, not scene code) and reports its box to the layout log.
- [ ] **Step 4:** Run the commands → PASS; `.venv312/bin/python -m ruff check .` clean.
- [ ] **Step 5:** Commit `[A] Motion scenes can show the user's own images through kit.Image`.

### Task A5: Image assets through the tools, SQL and the render

**Files:**
- Create: `supabase/migrations/20261223090000_motion_assets.sql`, `supabase/tests/195_motion_assets.test.sql`, `apps/web/lib/motion/assets.ts`
- Modify: `apps/web/lib/agent/explainer-tool.ts` (`assets` field; preview resolves; `prepareExplainer` puts `scene.assets`), `apps/web/lib/agent/scope.ts` (pass `lookupImage` and a signer into the explainer env), `supabase/schema/current.sql`
- Test: `apps/web/lib/agent/explainer-tool.check.ts`, the pgTAP file above

**Interfaces:**
- Consumes: `MotionAssetRefSchema` (A1), `inlineAssets` behaviour (A4), the scope's `lookupImage(path)` used by `generate_media`.
- Produces:
  ```ts
  // apps/web/lib/motion/assets.ts
  export async function previewAssets(supabase: SupabaseClient, refs: { name: string; ref: string }[]): Promise<MotionAsset[] | string>; // signed URLs, 600 s
  // explainer-tool.ts: sceneFields += assets?: { name: string; image: string /* library path, as generate_media's start_image */ }[] (≤ 6)
  ```
  SQL: `public.ai_check_spec` (where `startImage` is already checked with `ai_media_ref_ok`) refuses a motion scene whose `assets` is not an array of ≤ 6 `{name, ref}` with `public.ai_media_ref_ok(ref)` true, with `'An image in this animation is not in your library. Pick it again.'` (errcode `22023`).

- [ ] **Step 1: Write the failing tests.** pgTAP `195_motion_assets`: a scene with the user's own media object passes; another user's object, a `..` path, 7 assets and a missing `ref` each throw `22023` with the message above; a scene without `assets` still passes. Check script: an unknown library path returns `assets.0.image: … not an image saved to the cloud yet …` before any preview; a known one reaches the fake preview as an `https` asset and lands in the prepared spec as `{ name, ref }`.
- [ ] **Step 2:** Run `npm run db:reset && npm run db:test` and `cd apps/web && npm run check:contracts` → FAIL.
- [ ] **Step 3:** Implement; regenerate `current.sql` with `scripts/dump-schema.sh`; update the allowlist test `182_authenticated_function_allowlist` only if a function signature changes. The `scene` byte cap (4000) still holds: refs are short paths.
- [ ] **Step 4:** Run the commands → PASS; `supabase db lint` clean.
- [ ] **Step 5:** Commit `[A] Explainers take images from the user's library, checked in SQL and the worker`.

### Task A6: Verify by looking (Session A's real video)

- [ ] **Step 1:** Re-run A0's two briefs on the branch through the local MCP server (same client, same way). For brief 1 add a real OpenCMO screenshot from the library as an asset. Then run brief 1 once in the in-app Assistant to confirm it works there too.
- [ ] **Step 2:** Save stills and one full-size frame per render to `docs/plans/editor/2026-10-22-motion-quality-frames/after-a/`; in its `README.md` compare with baseline: rounds, minutes, the three worst problems now, and whether `jumpIssues` or the checklist caught anything real.
- [ ] **Step 3:** Measure peak RAM of the brief 1 render (`/usr/bin/time -v` around `clip-motion render`): must stay < 2 GB; note it in the README.
- [ ] **Step 4:** Commit `[A] Motion quality: after frames for Session A`.

---

## Session B — templates and short silent clips

### Task B1: The `motion-clip` model in the catalog and SQL

**Files:**
- Modify: `packages/contracts/ai-models.json` (row `motion-clip`: kind `video`, provider `opencmo-motion`, name `Motion clip`, price `{"unit":"explainer","credits":1}` with no `voiceKchars`, limits `aspectRatios` as explainers, `durations` 3–30 every 1 s, `scene: true`, no `voices`; extend the `$comment`)
- Create: `supabase/migrations/20261223100000_motion_clip.sql`, `supabase/tests/196_motion_clip.test.sql`
- Modify: `supabase/schema/current.sql` (the engine's `catalog.py` reads `ai-models.json` itself; no change there)

**Interfaces:**
- Consumes: `ClipSceneSchema`, `MOTION_CLIP_MODEL` (A1). **Must be written after pulling A5's migration**: it redefines the same check function and keeps A5's asset check.
- Produces: SQL accepts `{model: 'motion-clip', scene: {template: 'clip', …}}` with no `voice`; refuses `template: 'explainer'` on `motion-clip` and `template: 'clip'` on `motion-explainer`.

- [ ] **Step 1: Write the failing pgTAP:** a 5 s clip with 2 beats (`seconds` 2 and 3) creates a generation and holds 1 credit; a clip with a `voice` throws; beats summing to 31 s throw `'This motion clip is longer than 30 seconds. Shorten its beats.'`; 9 beats throw; `template: 'clip'` on `motion-explainer` throws; A5's asset refusals still hold for clips.
- [ ] **Step 2:** Run `npm run db:reset && npm run db:test` → FAIL.
- [ ] **Step 3:** Implement the seed and the checks; `cd apps/web && npm run check:api` (catalog vs SQL) must agree; regenerate `current.sql`.
- [ ] **Step 4:** Run `npm run db:test`, `npm run check:pricing` → PASS.
- [ ] **Step 5:** Commit `[B] Catalog: motion-clip, a silent 3-30 s motion piece`.

### Task B2: Clip timing in `clip-motion` and the silent worker path

**Files:**
- Modify: `packages/clip-motion/src/kit/timing.ts` (`buildTimeline` uses beat `seconds` when `kind === 'clip'`); `render.ts` already renders without `audio`, so the worker simply passes none
- Modify: `packages/engine/opencmo/ai/providers/motion.py` (template `clip`: no voice, `kind: "clip"`, beats with `seconds`), `packages/engine/opencmo/worker/generate_task.py` only if it branches on the model id
- Test: `packages/clip-motion/src/kit/timing.test.ts`, `packages/engine/tests/test_ai_motion_provider.py`

**Interfaces:**
- Consumes: `MotionJob.kind`, `BeatSchema.seconds` (A1); `motion-clip` row (B1).
- Produces: `buildTimeline` for a clip returns beat spans from cumulative `seconds`, `estimated: false`, `frames = duration * FPS`.

- [ ] **Step 1: Write the failing tests:** `a clip of beats 1.5 s and 2 s spans frames 0–45 and 45–105 in a 4 s timeline`; Python: `test_a_clip_renders_without_calling_the_voice` (voice adapter is never called; job has `kind: "clip"` and no `words`), `test_a_clip_mp4_has_no_audio_stream` (real ffmpeg probe of a 3 s render with the fake scene).
- [ ] **Step 2:** Run `npm run check:clip-motion` and the pytest file → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; ruff clean.
- [ ] **Step 5:** Commit `[B] Motion clips: timed beats and a silent render`.

### Task B3: `silent` in the tools and the op

**Files:**
- Modify: `apps/web/lib/agent/explainer-tool.ts` (`silent?: boolean`; beats take `seconds` when silent; `add_explainer` uses `motion-clip`, no `voice`, duration `clipSeconds`; card says "No narration"), `packages/mcp-server/src/groups/explainer.ts` (`get_explainer_kit` lists silent clips, their 3–30 s limits and price), `packages/editor-core/src/ops/explainer.ts` (accept a `motion-clip` spec; no captions layer follows), `apps/web/lib/agent/guides.ts` (when to make a silent clip: intros, product moments, logo reveals)
- Test: `apps/web/lib/agent/explainer-tool.check.ts`, `packages/editor-core/src/explainer.test.ts`

**Interfaces:**
- Consumes: A3's `direction`/`times`; A5's `assets`; B1's model; `ClipSceneSchema`, `clipSeconds` (A1).
- Produces: `preview_explainer` / `add_explainer` with `silent: true` → job `kind: 'clip'`; spec `{ model: 'motion-clip', scene: { template: 'clip', … } }`.

- [ ] **Step 1: Write the failing checks:** a silent preview with beats `[{say, seconds: 2}, {say, seconds: 2.5}]` sends job `kind: 'clip', duration: 5`; a silent add with a `voice` is refused with `voice: a silent clip has no narration.`; a silent beat without `seconds` is refused naming `beats.0.seconds`; the op places one video layer and no captions layer for a `motion-clip` spec; a narrated explainer still works unchanged (existing checks pass).
- [ ] **Step 2:** Run `cd apps/web && npm run check:contracts` and `npm run test:editor-core` → FAIL.
- [ ] **Step 3:** Implement. Leave tool names as they are (MCP clients already know them).
- [ ] **Step 4:** Run → PASS; `npm run typecheck`.
- [ ] **Step 5:** Commit `[B] Explainer tools make silent motion clips`.

### Task B4: Display face and device frames in the kit

**Files:**
- Create: `packages/clip-motion/src/kit/devices.tsx`
- Modify: `packages/clip-motion/src/remotion/fonts.ts` (`display` family from the bundled `plus-jakarta-sans.woff2`, already under `packages/clip-media/fonts/LICENSE-OFL.txt`), `packages/clip-motion/src/kit/index.ts` (`Phone`, `Browser`, `font`)
- Test: `packages/clip-motion/src/golden.test.ts`

**Interfaces:**
- Consumes: `kit.Image` (A4).
- Produces:
  ```ts
  // kit.Phone / kit.Browser props: { image?: string /* asset name */; x: number; y: number; w: number; scale?: number; rotate?: number; children?: React.ReactNode }
  // kit.font: { title: string; text: string; mono: string; display: string } (CSS font-family values)
  ```

- [ ] **Step 1: Write the failing golden tests:** a `Phone` holding an image asset renders with the screen inside the bezel (layout box of the image within the phone's box, 9:19.5 screen); a `Browser` at `w: 960` renders its bar 40 px tall at 1080 scale; text with `kit.font.display` renders in Plus Jakarta Sans (the font loads before frame 0, as the others).
- [ ] **Step 2:** Run `npm run check:clip-motion` → FAIL.
- [ ] **Step 3:** Implement our own frames (no copied drawing code); drop shadows and radii from the theme.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `[B] Motion kit: a display face, phone and browser frames`.

### Task B5: Template library from the Opus remakes

**Files:**
- Create: `packages/clip-motion/templates/{mark-lockup,phone-carousel,analytics-glow}/{scene.tsx,template.json,SPEC.md}`, `packages/clip-motion/templates/index.ts`, `packages/clip-motion/src/templates.test.ts`
- Modify: `apps/web/lib/agent/explainer-tool.ts` (tools `list_motion_templates`, `get_motion_template`), `packages/mcp-server/src/groups/explainer.ts` (same two tools, no clip needed), `apps/web/lib/agent/guides.ts` (start from a template when one fits), `THIRD_PARTY_NOTICES.md` (opus-pro/opusclip-video-tools `remakes/`, MIT, with the copyright line)

**Interfaces:**
- Consumes: `kit.Image`, `kit.Phone`, `kit.font` (A4, B4); clip kind (A1/B2).
- Produces:
  ```ts
  // templates/index.ts
  export type MotionTemplate = {
    id: string; title: string; description: string;
    kind: 'clip' | 'explainer'; format: '16:9' | '9:16' | '1:1'; seconds: number;
    slots: { name: string; kind: 'text' | 'image' | 'color'; note: string; default?: string }[];
    beats: { say: string; label?: string; seconds?: number }[];
    direction: string;   // the SPEC.md text, already a valid `direction`
    code: string;        // scene body for (React, R, kit), slots read from `const SLOTS = {...}` at the top
    source: { repo: string; path: string; license: 'MIT' };
  };
  export const MOTION_TEMPLATES: readonly MotionTemplate[];
  // tools: list_motion_templates {} → [{id, title, description, kind, format, seconds, slots}]
  //        get_motion_template {id} → the whole MotionTemplate
  ```

- [ ] **Step 1: Write the failing tests** in `templates.test.ts`: every template's `code` passes `guardScene`; each previews (fake 1×1 PNGs for image slots) with no layout or jump issues; `direction` length is 120–3000; `seconds` within the kind's limits; `source.license === 'MIT'`. Check script: `get_motion_template { id: "nope" }` answers with the list of ids.
- [ ] **Step 2:** Run `npm run check:clip-motion` and `cd apps/web && npm run check:contracts` → FAIL.
- [ ] **Step 3:** Port `remakes/opus-5.5/{pf-mark-lockup,pf-phone-carousel,template-analytics-glow}/project/src` into scene bodies: 60 fps timings converted to seconds at our 30 fps, `staticFile` images replaced by image slots, their fonts by `kit.font.display`, product names and copy replaced by slots. Keep their motion (curves, overshoot, stagger) exactly. `SPEC.md` = their `TASK.md` spec numbers rewritten for our sizes. Do not copy media.
- [ ] **Step 4:** Run → PASS; render each template once at full size and look at the frame at its midpoint and last frame next to the remake's `compare.jpg` (URL in their README).
- [ ] **Step 5:** Commit `[B] Motion templates: brand reveal, phone carousel and analytics, from Opus's MIT remakes`.

### Task B6: Real videos for OpenCMO (Session B's real video)

- [ ] **Step 1:** Through Claude Code on the local MCP server: (a) an OpenCMO logo reveal from `mark-lockup` (silent, 16:9); (b) a phone carousel of three real OpenCMO screens from `phone-carousel` (silent, 9:16), screens uploaded to the library first.
- [ ] **Step 2:** Save full-size frames at 25%, 50% and the last frame of each to `docs/plans/editor/2026-10-22-motion-quality-frames/after-b/`, with rounds, minutes and peak RAM in its `README.md`.
- [ ] **Step 3:** Owner publishes the better of the two as landing material (CLAUDE.md "Every phase ends with a real video").
- [ ] **Step 4:** Commit `[B] Motion quality: after frames for Session B`.

---

## Not in this plan (decide after A0/A6)

- Which model writes the code (owner: not important now; MCP clients bring their own).
- 60 fps and true motion blur (sub-frame accumulation, as the `pf-brand-dots` build log does). Cost: render time ×2+ against the RAM budget.
- More templates beyond three; a template gallery in the editor UI.

## How to verify (end of plan)

- `npm run typecheck && npm run build`; `npm run check:clip-motion`; `npm run test:editor-core`; `cd apps/web && npm run check:contracts`; `npm run check:mcp-server`; `npm run db:reset && npm run db:test`; engine `pytest -q` and `ruff check .`.
- Frames in `docs/plans/editor/2026-10-22-motion-quality-frames/{baseline,after-a,after-b}/`, looked at, side by side, in the PR.
- Deploy notes for the owner (do not deploy from a session): `supabase db push` before Vercel picks up code that sends `assets` or `motion-clip`; add `OPENCMO_MOTION_ASSET_ORIGIN` to `opencmo-motion`; `modal deploy modal_app.py`; `modal run check_deploy_env.py` → `Deploy env OK.`
