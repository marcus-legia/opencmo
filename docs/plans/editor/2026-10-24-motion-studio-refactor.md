# Motion studio refactor: art direction first, the kit as a library

Status: **in progress** (2026-10-24), one session (Session B stopped after B1; this plan takes over B2-B4).
Branch: `plan/editor/2026-10-24-explainer-freeform-motion` (the free-form plan's A1-A3 and B1 are its first commits).
Supersedes the free-form plan's remaining tasks (B2 wiring, B3 eval, A4 frames) — they are folded in below.

## Why (owner, 2026-10-24)

The owner tested explainers over the claude.ai connector after #104 and the free-form work: "boring, nothing
different… it keeps a fixed background". The cause is not the model (the claude.ai client is the same Opus 5.5 that
writes good motion in Claude Code) but what we wrap around it:

| What we do | Effect |
|---|---|
| Guide: "Wrap the whole scene in `<Stage>`" — two themes only (navy grid / cream paper) | Every video has one of two backgrounds |
| Guide: colours by name only, "Never pick other colours" (4 semantic colours) | Every video has the same four colours |
| Guide: one `Headline` row on top, a `Board` for lists, an icon or Lottie per noun | Every video has the same layout and the same clip-art |
| One code blob for a 15-90 s video | The opposite of the Opus formula: small scope per piece |
| Review asks "overlap? empty? jumps?" | Nothing asks "is it beautiful?" |

What Opus' 34 remakes (`opus-pro/opusclip-video-tools/remakes/opus-5.5`, MIT) and Claude Design have in common
(`docs/research/editor/2026-10-22-motion-quality-opus-claude-design.md`): small scope, a spec with numbers, a long
render → look → fix loop, real assets, and **free art direction per piece** (each remake has its own palette,
background, type and motion vocabulary).

## Decisions

1. **Art direction is chosen per video, first.** A *motion style* is a named art direction: palette (hex), background
   recipe, type pairing, motion vocabulary with numbers, do/don't, and one example shot rendered in a test. Styles live
   in `packages/clip-motion/styles/<id>/` (`style.json`, `STYLE.md`, `example.jsx`), generated into an index like the
   templates, and are served by two new tools `list_motion_styles` / `get_motion_style` (MCP and Assistant). The model
   may also derive its own direction from the user's brand kit; a style is a starting point, not a cage.
2. **The kit becomes core + library.**
   - *Core* (what every scene uses, no visual opinion): timing (`beat`, `cue`, `at`, `fps`, `frames`), frame and safe
     areas, `Mark` (tagged free drawing), `Text` (tagged free typography: any colour, font, weight, tracking —
     the layout report still checks size, overlap, safe area), `Shot` (one beat as its own small component with a local
     frame), motion helpers (`kit.curves`, `kit.tween`, `kit.spring`, `kit.noise`, `kit.drawOn`, `kit.speedBlur`) and
     `kit.fx` (`Grain`, `Vignette`, `GradientField`, `LightSweep`).
   - *Library* (opt-in, only when a standard symbol or ready-made piece is the clearest picture): `Icon`, `Lottie`,
     `Shape`, `Path`, `Arrow`, `Group`, `Burst`, data marks, `Board`, `Headline`, `Title`, `Label`, `Phone`, `Browser`,
     `Image`, `Stage`, `Camera`, 3D (`add_3d_scene`). Names stay on `kit` so every existing scene and template still runs.
3. **`theme` and `kit.color` stay** (SQL enum, price card, old scenes) but only seed defaults; a scene may paint any
   background and use any colour. The guide's colour rule becomes "the style's palette; text readable against what is
   behind it".
4. **Scenes are written shot by shot.** One `function ShotN()` per beat (or per two short beats), each small, composed
   with `<Shot beat={i}>`; transitions between shots are explicit (`kit.transition`: cut, crossfade, push, mask wipe,
   zoom-through). The preview's `times` already lets the model look at one shot at a time.
5. **The review asks for beauty.** The checklist gains the bar from the Opus TASK.md ("match every number, then make it
   as beautiful as you can: easing, motion blur, typography, depth, composition; resting text crisp") and one forcing
   question: "What would a launch video by a top design team do differently here? Do that."
6. **No SQL change, no new runtime, sandbox unchanged.** Guard, 32,000-char limit, 60 previews/hour stay.

## Work (one session, in this order; each ends green and committed)

- [ ] **R1 Kit core** (`packages/clip-motion/src/kit/`): `Text` (`text.tsx`, tagged with `TextTag`, props
  `name? text x y w? size font? weight? color? align? tracking? lineHeight? at? exitAt?`), `Shot` + `useShot()`
  (`shot.tsx`: children render from `beat(i).from - pre` to `beat(i).to + post`; `useShot()` → `{ frame, frames, progress }`
  local to the shot), `curves.ts` (`expoOut, quartOut, quintOut, backOut(capped), anticipate, smooth, snap` as
  `Easing.bezier` values + `tween(frame, [f0, f1], [a, b], curve)`), `noise.ts` (seeded 1D/2D value noise),
  `drawOn(progress)` → stroke props, `speedBlur(prev, next, k, max)`, `fx.tsx` (`Grain`, `Vignette`,
  `GradientField` (animated mesh of 3-5 colour blobs), `LightSweep`). Tests: vitest units for curves/noise, golden
  renders for `Text` (box + size reported), `Shot` (renders only in its range), `GradientField` (not a flat colour).
- [ ] **R2 Motion styles** (`packages/clip-motion/styles/`, `scripts/build-styles.mjs`, `src/styles.ts`): six styles,
  each with an example shot that uses no icon/Lottie and no `Stage`, rendered in `golden.test.ts` with a clean layout
  report: `editorial` (Fraunces, ink on warm paper, one accent, Swiss grid, hard cuts), `kinetic-type` (Plus Jakarta
  800, type is the subject, mask reveals, snap curves — after `pf-type-snap`), `product-ui` (soft light field, devices,
  real screenshots, glass cards, shadows — after `pf-phone-carousel`), `neon-tech` (deep navy/black, glow, thin grid,
  data lines — the old blueprint done right), `gradient-flow` (mesh gradient field, big numbers, glass capsules —
  after `pf-color-field`, `template-analytics-glow`), `paper-cutout` (layered paper shapes, soft drop shadows,
  2-frame jitter). Port code from the Opus remakes only under MIT with notice in `THIRD_PARTY_NOTICES.md`.
- [ ] **R3 Tools** (`apps/web/lib/agent/explainer-tool.ts`, `scope.ts`, `packages/mcp-server/src/groups/explainer.ts`):
  `list_motion_styles` (id, title, one line, best for) and `get_motion_style` (STYLE.md + example code), free, no clip;
  mirror `list_motion_templates`. `get_explainer_kit.read_first` names them first. Checks in `explainer-tool.check.ts`
  and `server.check.ts`.
- [ ] **R4 Guide rewrite** (`apps/web/lib/agent/guides.ts` `explainer`, `motion-guide.ts`): order = art direction
  (pick or derive a style) → storyboard → direction with numbers per shot → code (shots, core, curves, fx; library only
  when needed) → preview loop with the beauty bar → add. The example is `EXPLAINER_EXAMPLE` rebuilt in the
  `neon-tech` style with `Shot`s. Remove the two-themes/four-colours/Headline-every-video rules.
  `REVIEW_CHECKLIST` gains the bar and the forcing question. Checks in `agent-design.check.ts`.
- [ ] **R5 Eval** (`apps/web/lib/agent/eval/tasks.ts`): `drawable(visual, code)` accepts a `Mark`/`Text`/style-built
  shot; a fake case with a Mark-only scene. Fake eval green.
- [ ] **R6 Look** : the owner's flat-earth prompt and one OpenCMO product explainer, before (`main`) / after (branch),
  stills in `docs/plans/editor/2026-10-24-explainer-freeform-frames/{before,after}/`, looked at side by side.

## Verify

`npm run typecheck && npm run build`; `npm run check:clip-motion`; `npm run check:mcp-server`;
`cd apps/web && npm run check:contracts`; fake eval; frames looked at.

## Deploy (owner, after merge)

1. Worker: `cd packages/engine && .venv312/bin/modal deploy modal_app.py` (MotionPreview and render get the new kit).
2. MCP: `npm run build --workspace @opencmo/mcp-server && cd packages/engine && .venv312/bin/modal deploy mcp_app.py`;
   stop any `opencmo-mcp` container older than the deploy.
3. Web: Vercel on merge. 4. claude.ai: reconnect the opencmo connector, new chat.
