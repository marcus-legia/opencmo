# Learn how Opus makes video, into the editor: craft kit, review loop, talking-head camera, multi-scene videos

Status: **plan, not started** (2026-10-24). Owner ask: "remove 3D and Lottie, then study everything Opus Agent did in
animation and plan it for us". The removal is done (`2026-10-24-remove-3d-and-lottie-plan.md`); this plan is the second
half. Source report (Vietnamese): [`docs/research/editor/2026-10-24-opus-animation-toan-bo.md`](../../research/editor/2026-10-24-opus-animation-toan-bo.md).
Builds on the motion studio refactor (`2026-10-24-motion-studio-refactor.md`, same branch): styles, `Shot`, `Text`,
`Mark`, `kit.curves`, `kit.fx`, three ported MIT templates.

## Why

Opus makes animation in five places (Agent Opus motion graphics, the Opus Video Studio plugin with 43 templates and 34
Claude Opus 5.5 remakes, the AI Producer talking-head plugin, Story Mode camera rules, video-perception). What makes their
work look good is not a big library: it is craft written into each file, and a review loop that measures. Most of it fits
our one renderer (Remotion in `clip-motion`) or our editor document ops, with no new runtime.

**Scope (owner, 2026-10-24): learn Opus's ways of making video and build them into the editor.** Marketing pages and
OpenCMO's own launch video come later; nothing here touches the landing page. Ranked by how much each item raises the
quality of videos made in the editor:

| # | Item | Video it unlocks | Cost |
|---|---|---|---|
| O1 | Craft kit: intent eases, camera shot list, retime, type stream, sub-frame motion blur, goo, OKLab | Every explainer and motion clip looks finished | S–M |
| O2 | Review loop: contact sheet, zoom crop, audit over time | Fewer broken renders; the model fixes what it can measure | M |
| O3 | Multi-scene product videos: learn how Opus's 40.8 s `agent-opus` video is built (MIT) and teach it to the editor | Product demos and feature videos of several scenes that flow as one | M–L |
| O4 | Talking-head camera moves and pacing (AI Producer recipes) | Founder clips (V1) that feel edited | M |
| O5 | Style-frame gate before code (Agent Opus Motion Designer flow) | The right look on the first full render | S |
| O6 | Dynamic caption patterns with a selection table | Founder clips, explainers | M |
| O7 | More MIT components as templates | Feature launches, data stories | M each |
| O8 | Talking-head registers: seat / overlay / full cover from the measured face | Founder explainers with on-screen visuals | L |

Order: O1 → O2 → O4 → O5 → O3 → O6 → O7 → O8. Each is its own PR on its own branch,
and each ends with a real video made in the editor (CLAUDE.md, "Every phase ends with a real video").

## Decisions

1. **One renderer.** Everything here is either Remotion in `clip-motion` (scene code, templates, kit) or editor-core ops
   rendered by `clip-render` (talking-head moves, captions, layouts). No three.js, no Lottie, no in-browser compile.
2. **Copy only MIT code, with notice.** `templates/` and `remakes/` of `opus-pro/opusclip-video-tools` and
   `opus-pro/ai-producer-plugin` are MIT (AIP's composition skill is Apache-2.0). Add each ported file to
   `THIRD_PARTY_NOTICES.md` (the existing `LICENSE-opus-remakes.md` row covers templates and remakes). Never copy media,
   logos, voices or sample brands. `plugins/opus-video-studio/` has no licence: learn the ideas, write our own words.
   `reelmakeeasy` is AGPL: learn only.
3. **New kit pieces are core, not library.** They carry no visual opinion (no colour, no font), so every style uses them.
4. **Numbers before code** stays the rule (from the 22/10 plan): a shot's direction has timings, curves and geometry; the
   new audit checks those numbers.
5. **No new package:** motion blur is our own sub-frame sampler (see O1 notes).

## Work

### O1. Craft kit (`packages/clip-motion/src/kit/`), one PR — built 2026-10-24

Built notes: `MotionBlur` is our own (Remotion's `CameraMotionBlur` duplicates the layout tags), so no new package;
its children may be a function `(frame) => …` (a position computed outside does not blur). `ShaderField` falls back
to `GradientField` where the Chromium GL backend gives no WebGL2 (here only `swangle` does); scene code may not call
`getContext`. Frames: `2026-10-24-opus-animation-frames/o1/`.


Learned from `templates/agent-opus/project/src/agent-opus/code-ui/motion.ts`, `directed/Conversation.tsx` and the remakes'
BUILD-LOGs (MIT; port the maths with notice, rename to our style).

- [x] **Intent eases** (`curves.ts`): `kit.ease.arrive (.22,1,.36,1)`, `travel (.76,0,.24,1)`, `leave (.4,0,1,1)`,
  `expand (.7,0,.2,1)`, `stream (.22,.06,.62,1)`, `impulse` (the `.62/.18` sweep with zero end velocity). Guide line:
  "arrivals decelerate, exits accelerate, pick the curve by intent". vitest: endpoints, monotone, `impulse` end velocity 0.
- [x] **Camera shot list** (`stage.tsx`): `kit.shots([{ from, to, pose: { scale, x, y } }, …])` → the pose at a frame, held
  between shots, joined by `impulse`; `kit.poseBlur(prev, next, { k, max })` gives x/y blur from the pose change (the
  `blurFor` rule: scale change counts, capped 16/12 px). `Camera` gains `shots` and applies the blur on the moving layer
  only. Golden: 3 frames (rest, mid-move blurred, rest crisp).
- [x] **Retime** (`timing.ts`): `kit.retime(knots)` → a monotone cubic time warp (`[outputSec, sourceSec]` knots) with its
  inverse, so a whole scene speeds up or slows down without moving any approved landing. vitest: monotone, passes every
  knot, inverse round-trips within 1e-6.
- [x] **TypeStream** (`text.tsx`): letters of a whole paragraph emitted on ONE schedule (one curve over the whole text,
  line breaks are layout only), each letter going from blur (default 20 px) to sharp over `letterMs` (default 323), with
  an optional tail speed-up. Tagged like `Text` so the layout report measures it. Golden: mid-stream and settled.
- [x] **MotionBlur** (`fx.tsx`): `kit.fx.MotionBlur` wraps `@remotion/motion-blur` `CameraMotionBlur` (shutter angle,
  samples 6–48). Guide: use it on fast travel only, never on resting text; measure render time on the vaccine fixture
  (budget: ≤ 2× the frame time at 16 samples, else lower the default).
- [x] **Goo and OKLab** (`fx.tsx`, `color.ts`): `kit.fx.Goo` (SVG gaussian + alpha threshold, SourceGraphic composited
  *over* so shapes keep their exact size) for liquid splits and merges; `kit.mix.oklab(a, b, t)` so colour changes never
  pass through mud. Golden: a pill splitting into three circles; vitest: OKLab mid-point of lime→green is not olive.
- [x] **ShaderField** (`fx.tsx`, optional in this PR): a WebGL2 fragment-shader background with no library, drawn from
  the frame only, context created inside the window and released outside it (the AIP `code-drawn` rules), grain ≤ 2 %.
  `guard.ts` already refuses `requestAnimationFrame`, timers and `Math.random`; add a rule refusing `getContext` in
  scene code, so `ShaderField` is the only place a WebGL context is made. Golden: not a flat colour, identical on two
  renders.
- [x] Guide (`apps/web/lib/agent/guides.ts` `explainer`, `motion-guide.ts`): the kinetic-type purpose table (introduce an
  idea, change one word through a mask, pick one of several, turn text into a UI action, emphasise and resolve) in our
  own words; "change one variable per review round"; the new pieces in the core list.
- [x] Look: re-render the six style examples and both fixtures, contact sheet in
  `docs/plans/editor/2026-10-24-opus-animation-frames/o1/`.

### O2. Review loop that measures (`packages/clip-motion/src/preview.ts`, `layout.ts`, tool `preview_explainer`), one PR — built 2026-10-24

Built notes: within the 55 s preview budget the audit runs on the frames a preview already measures (stills, their
neighbours, the paired layout samples and the contact sheet), not every 2nd frame; the guide says so. Sheet and zoom come
back as extra entries of `stills` (`kind: "sheet" | "zoom"`), so the web, local and Modal paths needed no change. A
declared name matches the box name exactly or after its component prefix (`Mark ship`). Eval task `explain-measured`.

Learned from the remakes' BUILD-LOGs (contact sheets, segment checks, zoom crops, luma, `spatial-audit.json`) and
video-perception (sample by change, not uniformly).

- [x] `preview_explainer` takes `sheet: { from, to, count ≤ 12 }` → one contact-sheet image of `count` frames across a
  window, labelled with frame numbers, so the model sees motion, not three stills. Counts against the existing 60
  previews/hour.
- [x] `zoom: { time, box }` → a full-resolution crop to check that resting text is crisp.
- [x] **Audit over time** in the layout probe (every 2nd frame of each shot at quarter size, measured only):
  overlap area between tagged boxes per frame (report the worst frame and px²), smallest clearance to the safe area,
  **jumps** (a tagged box moving more than 12 % of the short side in one frame, or scale changing more than 1.4× in 3
  frames: the "teleport" and "dive too violent" cases), and **resting crispness** (a tagged box with a blur filter or a
  non-identity transform after its last keyframe).
- [x] **Scene-declared checks**: `kit.audit.clear(nameA, nameB, { px })`, `kit.audit.inside(name, area)` let the code
  state its own numeric promises (the `spatial-audit.json` idea); the report lists pass/fail per check.
- [x] Review checklist (`REVIEW_CHECKLIST`): read the audit first, fix one layer, replay that shot and its neighbours.
- [x] Eval (`apps/web/lib/agent/eval/tasks.ts`): a fake case whose first preview has an overlap and a jump; the fake
  provider fixes it after reading the audit. Checks: `explainer-tool.check.ts`, MCP `server.check.ts`.

### O3. Multi-scene product videos, learned from Opus's `agent-opus` video, one PR

`templates/agent-opus/project` (MIT, 1920×1080, 30 fps, 40.8 s) is the best example Opus publishes of a whole product
video in code: opening type → prompt box → inputs → chat with the agent → approve → storyboard → results → logo, flowing
as one piece. Learn its method and give it to the editor; a ready template is a by-product, not the goal.

- [ ] Read the whole source (`Film.tsx`, `code-ui/*`, `directed/*`, `locked/Workflow.tsx`, `multiples/*`, `config/*.json`)
  and write down how it holds together: content kept apart from code (`template.json`), section starts
  (`timeline.json`), voice phrases with times (`audio-cues.json`), one film clock with a time warp, camera as a shot list,
  shared elements carried from scene to scene, one text stream for the screenplay.
- [ ] Teach it to the Assistant: a guide section "a product video of several scenes" (one subject carried across scenes,
  section starts from the voice phrases, `kit.retime` to tighten without moving landings, transitions that keep position
  and identity), and `preview_explainer` checks over the whole timeline (O2 sheets per section).
- [ ] Optional: port the video as a motion template with slots (copy, product name, logo, colours, the user's own
  screenshots, voice phrases), with notice in `THIRD_PARTY_NOTICES.md`; never Opus's media, logo or narration. Fonts it
  uses that we lack (Geist, Instrument Serif, both OFL): map to fonts we ship unless a side-by-side still shows a loss.
- [ ] Check: make one multi-scene demo video in the editor (any sample product), extract frames from the full-size file,
  look at them. Not published; it only proves the method.

### O4. Talking-head camera moves and pacing (`packages/editor-core/src/ops/`, guides), one PR

Learned from AI Producer `aip-composition/references/motion-recipes.md` and `aip/SKILL.md` (MIT; we rewrite them as
document keyframes so preview and export draw the same thing).

- [x] Op `add_camera_move { kind, quote | start, duration?, params? }` with kinds `impact_shake` (0.2–0.45 s, amplitude
  2–40 px), `white_flash` (≤ 0.35 s), `whip` (0.25–0.4 s, ±160 px), `push_in` (amount 0.02–0.4), `handheld`
  (1–12 px, ramps in/out over 0.4 s), `beat_pulse` (0.2–0.3 s, 1–15 %). Each is a pure function of `(t, d, params,
  seed)` baked into keyframes on the speaker piece (`x`, `y`, `scale`, `rotation`) or a white rect (`flash`); seeded
  noise, never `Math.random`. Rerunning on the same words replaces the move.
- [x] Rules enforced in the op (not only the guide): at most one shake or flash per 20 s of clip; never on a piece hidden
  by a layout panel; the zoom keeps the frame covered (reuse the `punch_in` margin rule).
- [x] Guide `pacing` (new) or `hooks`: a new visual beat every 4–6 s of speech; punch-ins ≥ 1.3× on emphasis; a
  monochrome close-up for one sentence on an aside (existing colour ops); return to the full-frame speaker between
  visuals; labels pass a deletion test.
- [x] Tests: op golden (keyframes for each kind), the 20 s rule, cover rule; export a real founder clip with a shake on
  the number and a push-in on the build-up; look at frames.

**Built (2026-10-24).** `packages/editor-core/src/ops/camera.ts`: `add_camera_move` (quote or start, duration and
strength clamped to each kind's range, whip direction, seed) and `remove_camera_moves`. The moves live in the scene mark
`camera-moves` (clip seconds, plus fingerprints of the tracks they baked: cuts copy tracks without ids). `applyOps`
runs `syncCameraMoves` after every batch, next to `syncVoiceovers`, so cuts, `punch_in` and reframes re-bake the
keyframes (`scale`, `offsetX`, `offsetY`, `rotation` on each master piece, in source seconds; a push-in holds until
the next cut, where the jump back reads as the cut). A flash is a white rect with an opacity track under the captions.
The cover rule is exact: every frame corner, seen from the box centre in the box's turned axes, must fit inside the
scaled box, and the zoom grows just enough when it does not. Pieces with hand-made keyframes on those properties are
left alone (the op refuses them). The guide `pacing` has a "Beats and camera moves" section; the Assistant gets both
ops (MCP lists them through the op registry). Tests: `camera.test.ts` (each recipe, baking, the 20 s rule, cover
check against the renderer's transform, replace on rerun, cuts, layouts, removal). A real export (16:9 master in
9:16 with a shake, push-in, handheld, whip and flash) rendered and checked frame by frame: no black edges.
Not done: a `speaker.cameraMove` capability for style skills (no style preset asks for it yet).

### O5. Style-frame gate (`/explain` flow), one PR

Agent Opus's Motion Designer settles style and key frames before the clip.

- [x] Guide step 1 becomes: pick two or three directions (motion styles or one derived from the brand kit), write only
  the first beat's hero shot for each, preview them as one sheet, and ask the user to pick (`ask_user` with the sheet in
  the app; over MCP the client shows the image). Then storyboard and the full scene in the chosen direction.
- [x] `preview_explainer` accepts `variants: [{ code }]` (2–3) and returns one labelled sheet; counts as one preview.
- [x] Fake eval and MCP check updated.

**Built (2026-10-24).** `preview_explainer` takes `variants: [{ label, code }]` (2-3; `code` may then be left out):
clip-motion's `previewVariants` compiles each direction, renders its hero still at `times[0]` (default beat 1's
middle) in one browser, reports each one's layout issues under its label, and tiles them left to right into one
image (`kind: 'variants'`, `labels`). A direction that fails to compile fails the preview with its label. The result
skips the review rounds and asks the model to show the image and `ask_user` with the labels. Guide `explainer`
step 1 and the `/explain` directive offer it for a new video with no chosen look; the MCP instructions say the same
(the tool schema is shared). Tests: two clip-motion goldens (side-by-side colours, the failing label), the
explainer-tool check, and the fake eval task `explain-directions` (directions previewed in one call before asking,
then the whole scene and add_explainer).

### O6. Dynamic caption patterns (`packages/clip-render/src/captions.ts`, editor-core captions), one PR

- [x] Compare our caption presets with AI Producer's eight patterns (`blur-ladder`, `editorial-stack`, `inverted-stack`,
  `lead-in-flare`, `pace-adaptive`, `scribble-subtitle`, `solo-word-punch`, `tilt-slam`): which we already draw, which are
  missing. Build the missing ones that fit our renderer (the emphasis word in a serif, at most one per phrase).
- [x] Guide `captions`: a selection table by video type (tutorial, talking head, story-time, hype, dense) and the rule
  "quiet pattern when visuals share the frame most of the time".
- [x] Golden per pattern on the parity fixtures.

**Built (2026-10-24).** AI Producer publishes only the names, the selection table and the knobs of its eight patterns;
the drawing runs on their service. Our presets already cover four of them: `pace-adaptive` ≈ `whisper`/`classic`,
`inverted-stack` ≈ `stark` (difference blend), `solo-word-punch` ≈ `classic` with `highlight: 'pop'`,
`editorial-stack` ≈ `paper`/`cascade`; `lead-in-flare`'s emphasis-word treatment existed only as `emphasisStyle`.
Built two new presets in `clip-render/src/captions.ts`: **`flare`** (the phrase in a quiet Inter, then the payoff word,
the emphasized one or the last, lands once spoken on its own line in Fraunces italic at 1.7×, in `colors[0]`) and
**`slam`** (uppercase Archivo Black; the emphasized or longest word sits on a −4° accent slab, drawn by the block
pass in `text.ts` with a tilt). Not built: `blur-ladder` (per-word blur needs a text-range blur the renderer lacks)
and `scribble-subtitle` (hand-drawn marks need a path pass on caption words); both are noted for the caption roadmap.
The caption picker, the inspector's colour slot, the brand kit and the style presets take the new names from
`CAPTION_PRESETS`. Guide `captions` has the selection table by video type and the "quiet preset when visuals share
the frame" rule. Tests: renderer unit tests (payoff placement, emphasis wins, slab range and tilt, never past the
frame edge) and parity samples `cap-flare` / `cap-slam` with OpenCMO-drawn references, approved by eye; every
existing parity frame stays byte-identical.

### O7. More MIT components as templates, one PR per two or three

Priority by the videos we need: `pf-type-snap` (headline snap: feature launches), `pf-cart-checkout` (a UI action with a
cursor: product demos), `template-case-research` (query → answer → evidence: the agent explaining itself),
`pf-trail-recap` (data reveal), `pf-color-field` (shader field, after O1's `ShaderField`), `study-brand-*` (short logo
intros). Each: port under MIT with notice, slots for copy/brand/screens, golden stills, `list_motion_templates` entry.

### O8. Talking-head registers from the measured face (`packages/editor-core/src/layout.ts`, `layouts.ts`), later

- [ ] Add seat forms beside `set_layout`'s splits: `card`, `circle`, `aperture` at the positions each frame allows
  (9:16 low-centred, 1:1 lower corner, 16:9 side column), placed from the face track, never `50% 50%`.
- [ ] Caption band per visual moment (position and ink), so captions never cross a panel.
- [ ] Plan this one separately when O1–O5 have shipped videos; it overlaps the active-speaker reframe work.

**Planned (2026-10-24)** in [`2026-10-24-talking-head-seats-plan.md`](2026-10-24-talking-head-seats-plan.md). Reading the
code for it found that new uploads have no face track at all: the engine's face pass left with the clipping pipeline
(2026-10-20), so `set_frame` and `punch_in` centre the frame on them. The seats plan starts by bringing a face pass
back (with the head box), then builds the seat forms, the caption band per moment and the morphs.

## Verify (each PR)

`npm run typecheck && npm run build`; `npm run check:clip-motion` (golden stills need Chrome Headless Shell; CI is the
authority); `npm run test:editor-core` (O4, O8); `npm run test:clip-render` + parity (O6); `cd apps/web && npm run
check:contracts` and the fake agent eval; `npm run check:mcp-server`; for O3 and O4 a real render, frames extracted from
the full-size file and looked at. Peak RAM of a motion render stays < 2 GB (`/usr/bin/time -v` on the vaccine fixture
before and after `MotionBlur`).

## Not doing

- three.js / `@remotion/three` (owner decision 2026-10-24), Lottie.
- Compiling scene code in the browser (Agent Opus does; we render on the server in a sandbox).
- Copying text from `opus-video-studio/plugins/` (no licence) or from `reelmakeeasy` (AGPL).
- Story Mode camera rules: already in the long-take plan (F2).

## Open questions for the owner

1. O4: allow `white_flash` at all for founders' clips, or only shake/whip/push? (Recommended: allow, with the 20 s rule.)
