# Plan: unit text animator + `add_title` (lower third, name tag, chapter)  (2026-10-17)

Track: Editor & motion · Work split: [`2026-10-17-text-animator-titles-sessions.md`](2026-10-17-text-animator-titles-sessions.md)

Source research: `docs/research/editor/2026-10-17-text-animator-lower-thirds.md` (PR #63, branch
`research/editor/2026-10-17-text-animator-lower-thirds`, not merged when this plan was written). Marcus left no
comments or reviews on PR #63, so the report's ranking stands.

## Goal and why

1. **Interview and podcast clips look edited from the first export.** Our users upload their own talking-head and
   interview videos. A name tag when someone first speaks, and chapter titles, are what make a clip look finished;
   OpusClip shipped 12 animated lower thirds created from a transcript selection on 2026-09-28, Descript shipped 10
   text animations on 2026-09-17. This is an activation item: the first clip a founder sees.
2. **One text-animation model instead of more presets.** Today only `wordSlide` / `highlightPop` animate per word,
   nothing animates per character or per line, and there is no masked line reveal. Adding `unit`, `order`, `step`
   and `mask` to the existing animations gives the editor and the Assistant many looks from four parameters
   (the After Effects / Lottie "range selector" idea, learned from Skottie, written fresh in TypeScript).
3. **A real bug:** `appearChar`, `typewriter` and `scramble` cut strings by UTF-16 code unit, so 👋🏽 splits into a
   broken glyph mid-animation and decomposed Vietnamese (NFD) shows letters before their marks.

Everything draws through `clip-render`, so preview and export stay identical. No worker change, no database change,
no new runtime (no GSAP/HTML, no Lottie text).

## Scope

| Id | Item | Report ref | Session |
|---|---|---|---|
| E1 | Grapheme-safe `appearChar` / `typewriter` / `scramble` | G3 | A |
| E2 | `unit` / `order` / `step` / `mask` on `AnimationSchema`, drawn by `clip-render` for `text` nodes | G2 | A |
| E3 | Masked line reveal measured with real glyph bounds (Vietnamese stacked marks) | G2 | A |
| E4 | Inspector controls for the new fields; parity sample; export measurement | G2 | A |
| E5 | `add_title` visual op: lower third, name tag, chapter title, tied to a quote, brand kit, title-safe | G1 | B |
| E6 | `check` issue `text-unsafe` (outside title-safe / platform UI zones) | G4 | B |
| E7 | Editor UI: "Title" in the Visuals panel + "Add title" from a transcript selection | G1 | B |
| E8 | Assistant: tool text, guide paragraph (rhythm + lower-third rules), eval task | G5 | B |

### Out of scope

- Unit animations on `captions` nodes (captions have their own `highlight` system; `caption.reveal` belongs to
  `docs/style-skills-build.md` Track B). The renderer ignores `unit` on captions in this plan.
- A Skottie-style selector *shape* (triangle/round ramps), `AnchorPointGrouping` options, variable-font axes,
  motion-canvas `tweenText`.
- Migrating old `wordSlide` documents to `slideUp + unit: 'word'` (only an equivalence test now; see Later).
- `add_hook_title` from `docs/style-skills-build.md` (see "Coordination").
- Any HTML/GSAP or Lottie-text path.

## Corrections to the report found while checking the code

- **Fitting text:** the report says `buildTitle` can size text with `clip-render`'s `Measurer` "as in `layoutText`".
  Visual builders in `editor-core` run on the server with no canvas: they size text with the estimate
  `textWidth`/`fitSize` in `packages/editor-core/src/visuals/common.ts` (`line.length × size × 0.56`). `add_title`
  uses that estimate with a wider factor for bold names, and the real-glyph check happens in the exported-frame
  review and in `checkDocument` when a measurer is available. Do not add a canvas dependency to the op path.
- **`text-clipped` already exists** as `text-overflow` in `packages/editor-core/src/check.ts`, but it only fires when
  a `measurer` is passed, and the Assistant's `runCheck` (`apps/web/lib/agent/tools.ts`) passes none. So E6 adds only
  `text-unsafe`, computed from the node's layout box, which works without a measurer.
- **Animation names:** the per-character animation type is `appearChar` (the function is `revealChars`);
  `typewriter` also goes through `revealChars` (`packages/clip-render/src/frame.ts`).
- **"`wordSlide` = `slideUp` + `unit: 'word'`"** only holds if the unit slide travels `0.6 × unit height` like
  `wordSlide` (`wordTweaks` in `text.ts`), not the node-level 100 px of `slideUp`. E2 specifies that.
- **Brand:** `visualNode` in `ops/visuals.ts` already applies `rebrand(themeFromBrand(readBrand(document)))` to every
  builder's nodes, so `buildTitle` only has to use `Theme` colors and `theme.font`.

## Design

### E1 — graphemes

- New `packages/clip-render/src/graphemes.ts`:
  `export function graphemes(text: string): string[]` — one cached
  `new Intl.Segmenter(undefined, { granularity: 'grapheme' })`; fallback `Array.from(text)` when `Intl.Segmenter` is
  missing. Never normalizes the string (NFC would change what the user typed).
- `revealChars(text, ratio)`: `const g = graphemes(text); return g.slice(0, Math.floor(ratio * g.length)).join('')`.
- `scramble(text, ratio)`: iterate graphemes; whitespace graphemes stay; the **seed is still computed over
  `charCodeAt` of the original string** and the settle formula uses the grapheme index and grapheme count, so ASCII
  strings give exactly today's output (the `anim-scramble` parity sample must not move).
- `typewriter` inherits the fix through `revealChars`.

### E2 — unit animator

Schema (`packages/clip-doc/src/schema.ts`, additive and optional, no document version change):

```ts
export const ANIMATION_UNITS = ['char', 'word', 'line'] as const;
export const ANIMATION_ORDERS = ['first', 'center', 'last', 'random'] as const;
/** Animations that can run per unit (char/word/line) on a text node. */
export const UNIT_ANIMATION_TYPES = ['fade', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'pop', 'blur', 'grow'] as const;

// AnimationSchema gains:
unit: z.enum(ANIMATION_UNITS).optional(),
order: z.enum(ANIMATION_ORDERS).optional(),        // default 'first'
step: z.number().min(0.02).max(0.5).optional(),   // seconds between two units' starts
mask: z.boolean().optional(),                      // only slideUp/slideDown; clips each unit to its line box
// superRefine: `unit` only with UNIT_ANIMATION_TYPES; `order`/`step`/`mask` only with `unit`;
// `mask` only with slideUp/slideDown. Messages in English ("unit works with fade, slideUp, …").
```

Regenerate `packages/contracts/clip-document.schema.json` (`node packages/clip-doc/scripts/json-schema.ts`;
`npm run check:clip-doc` fails until it is regenerated).

Renderer (`packages/clip-render`):

- `frame.ts` `applyAnimation`: when `animation.unit` is set on a `text` node, do **not** write node-level values;
  set `r.unitFx = { type, unit, order, step, t, total, out, mask, seed }` (new field on the render node in
  `tree.ts`, reset to `null` each frame like `wordFx`). On `captions` nodes `unit` is ignored (out of scope).
- Timing: `duration` keeps today's meaning, the whole animation. Defaults when absent: `step` = 0.03 s (char),
  0.055 s (word), 0.08 s (line); `duration` = `0.5 + step × (n − 1)` where `n` is the unit count for char/word
  (counted with `graphemes` / whitespace split in `frame.ts`), and 0.9 s for line (lines are only known after
  layout). In `drawText`, per-unit length = `max(total − step × (n − 1), 0.15 s)`.
- `text.ts`: `wordTweaks` becomes `unitTweaks(r, layout)`; the existing `wordSlide` / `highlightPop` / caption `pop`
  branches stay byte-for-byte. New branch for `unitFx`:
  - Domain map after `layoutText`: `char` = graphemes of each word, excluding whitespace, with x offsets from
    `measurer.measureText` of the prefix (cached per layout in a `WeakMap<TextLayout, …>` so a frame does not
    re-measure); `word` = non-blank words (as today); `line` = words grouped by `word.y`.
  - Rank by `order`: first = i; last = n − 1 − i; center = `round(|i − (n − 1)/2|)` (both sides of the middle move
    together); random = Fisher–Yates over 0..n−1 with a 32-bit hash PRNG seeded from the node id (+ animation id),
    so scrubbing and export draw the same frame.
  - Unit progress `p = clamp01((t − rank × step) / unitLength)`, eased with `SOFT` (out: reversed).
  - Tweak per unit around the unit's centre: fade → alpha; slideUp/Down → dy = ±(1 − e) × 0.6 × unit height,
    alpha = e; slideLeft/Right → dx = ±(1 − e) × 0.6 × unit height; pop → scale 0.6 → 1 with the back-out curve
    already used by `pop`; grow → scale 0.5 → 1; blur → `filter: blur(24 × (1 − e)px)` per unit (skip on Node if
    the canvas lacks `filter`, falling back to alpha; record which in the test).
  - `char` on a text longer than 200 graphemes falls back to `word` (cost cap), silently, documented in the guide.
- Exports from `clip-render/src/index.ts`: `graphemes`, and the pure helpers `unitRanks(n, order, seed)` and
  `unitProgress(t, rank, step, unitLength)` so tests and the editor can reuse them.

### E3 — masked line reveal

- `TextMetricsLike` gains optional `actualBoundingBoxAscent?` / `actualBoundingBoxDescent?` (browser canvas and
  `@napi-rs/canvas`, used by `clip-export`, both provide them).
- With `mask: true`, each unit is clipped (`ctx.save(); ctx.beginPath(); ctx.rect(...); ctx.clip()`) to its **line
  box**: top = line top − max `actualBoundingBoxAscent` over the line's glyphs + 0.08 em, bottom = max
  `actualBoundingBoxDescent` + 0.08 em, full line width. Font-size boxes cut "Nguyễn", "Hương": test that the mask
  box contains the measured box of "ễ".

### E4 — editor controls, parity, budget

- `apps/web/components/editor/inspector/parts.tsx`: for a text node with an animation in `UNIT_ANIMATION_TYPES`,
  show "By" (Whole / Letter / Word / Line), "Order" (First / Middle / Last / Random), "Gap" (named sizes
  Tight / Normal / Loose → the unit's default step × 0.6 / 1 / 1.6), and "Mask" for slide up/down. Labels in English;
  the user never types seconds for the gap.
- New parity sample `packages/editor-parity/samples/anim-units.json` (one text node per unit × order, plus a masked
  line reveal with "Nguyễn Thị Hương"). There is no Diffusion Studio oracle any more, so its reference PNGs are
  approved by eye (README rule) and committed with the sample.
- Export cost: `clip-export` renders a 60 s 1080×1920 document with 10 text nodes using `unit: 'char'`; measure with
  `/usr/bin/time -v` before and after E2. Accept if wall time grows < 10 % and peak RSS stays well under 2 GB.

### E5 — `add_title`

New `packages/editor-core/src/visuals/title.ts` (same pattern as `chart.ts` / `icon.ts`):

```ts
export const TITLE_KINDS = ['lowerThird', 'nameTag', 'chapter'] as const;
export const TITLE_LOOKS = ['bar', 'kicker', 'card'] as const;
export const TITLE_MOTIONS = ['calm', 'standard', 'punchy'] as const;   // named sizes, never seconds

export const titleInput = z.object({
  kind: z.enum(TITLE_KINDS).default('lowerThird'),
  title: z.string().trim().min(1).max(60),          // the name, or the chapter title
  sub: z.string().trim().min(1).max(80).optional(), // role / location / "Episode 12"
  look: z.enum(TITLE_LOOKS).default('bar'),
  side: z.enum(['left', 'right', 'center']).optional(), // default: left; chapter → center
  motion: z.enum(TITLE_MOTIONS).default('standard'),
}).strict();
export type TitleInput = z.infer<typeof titleInput>;

export function buildTitle(
  input: TitleInput,
  frame: { width: number; height: number },
  area: Box,           // where it may go: title-safe and clear of captions (computed by the op)
  duration: number,
): Node[];
```

- Children (all existing node kinds, no schema change): `rect` support panel (theme.panel, opacity ~0.9; no panel
  in `bar` look, a thick accent bar instead), `text` title, optional `text` sub (≈ 0.5 × title size), accent line
  (`strokePath` with `drawOn`) or kicker band (`rect` in theme.accent with the sub on it).
- Sizes: title size = `round(min(W, H) × 0.055)` (≈ 59 px on 1080 short side; rule 50–80 px), shrunk with `fitSize`
  (bold factor 0.62) to fit `area.width × 0.9`, never below 0.65 × base; one line for the title, one for the sub.
- Placement: inside a 6 % title-safe inset; on vertical frames also outside the top 10 % / bottom 16 % platform UI
  zones. `lowerThird` / `nameTag` sit in the lower third; when the captions box at `start` (from
  `createRenderer(document).layout(...)`, as `ops/structure.ts` does) overlaps, the title moves above the captions;
  if there is no room it goes to the upper safe band. `chapter` is centred.
- Motion: build-in staggered 0.10 / 0.32 / 0.50 s (accent, title, sub) × motion factor (calm 1.4, standard 1.0,
  punchy 0.7); build-out ≈ 0.3 s, faster than in, reverse order (`phase: 'out'` animations with delays).
  The title uses `slideUp` + `unit: 'word'` + `mask: true` once E2/E3 land; before that it uses node-level
  `slideUp` (B3 swaps it, see the sessions doc). Motion only at build-in / build-out: still while it is read.
- Timing: with `quote`, `start` = the quote's start, `end` = `max(quote end, start + 5.5)` capped at `start + 8`;
  with start/end, as given. `visualOp` gets an optional `limits` argument for this; `update_visual` works through the
  existing `visual` mark with no change.
- Registered in `ops/visuals.ts` (`BUILDERS.add_title`, `export const addTitle = visualOp('add_title', …)`) and in
  `REGISTRY` (`ops/index.ts`). A quote not in the transcript fails with the existing `quoteRange` `OpFailure`.

### E6 — `text-unsafe`

- `CheckIssue['code']` gains `'text-unsafe'` (severity `warning`): a `text` node (not `captions`) whose layout box,
  for at least 0.5 s, crosses the title-safe inset (5 % each side), or on vertical frames the top 10 % / bottom 16 %
  platform UI zones. Uses the layout box, so it works without a measurer (the Assistant's `runCheck` has none).
  Message: "<label> sits where the platform's buttons or captions cover it on phones."
- Titles built by E5 must produce no `text-unsafe`, `caption-overlap` or `captions-covered`.

### E7 — editor UI

- `apps/web/components/editor/visuals/VisualsPanel.tsx`: a "Title" kind next to icon/chart/diagram: fields Name/Title,
  Role/Subtitle, Kind (Lower third / Name tag / Chapter), Look, Side, Motion; "Add" runs `add_title` at the playhead
  (end + 5.5 s). Selected title groups open the same form through `update_visual`.
- `apps/web/components/editor/transcript/TranscriptPanel.tsx`: with words selected, an "Add title" action pre-fills
  `title` with the selection and `quote` with the same words (the OpusClip flow). Writes go through editor-core ops
  only.

### E8 — Assistant

- `apps/web/lib/agent/tools.ts`: `add_title` description (kinds, looks, quote timing, "one name tag per speaker at
  first appearance"); `update_visual` text gains `add_title`.
- `apps/web/lib/agent/guides.ts`: a paragraph on titles and text rhythm, in our own words: unit by length (letters
  ≤ ~20 characters, words for a tagline, lines for a paragraph), gaps (letters 0.02–0.04 s, words 0.04–0.07 s, lines
  0.06–0.1 s), total reveal ≲ 0.8 s, out faster than in, still while read, support panel behind text, title-safe.
  Plus the new animation fields in the `animations:` line (text provided by Session A via Requests).
  If any sentence follows `iart-ai/lower-thirds-skills` or `kinetic-typography-skills` closely, add an MIT line to
  `THIRD_PARTY_NOTICES.md`; otherwise none is needed (numbers are common practice).
- `apps/web/lib/agent/eval/tasks.ts`: task `name-tag` — prompt "Add my name and role when I introduce myself: I'm
  Linh, founder of Paylane"; graded by code: exactly one `add_title` group, `marks.visual.input.quote` present, title
  contains "Linh", no invented seconds outside the clip, `check` has no `text-unsafe`.

## Coordination

- **`docs/style-skills-build.md`** (Track B, not started, no open PR) plans `add_hook_title` as its own op. After this
  plan lands, that item should become `kind: 'hook'` of `add_title` reusing `buildTitle`. This PR does not edit that
  doc (scope rule); the note goes in the PR description and "Later".
- **PR #59** (`mcp-agent-team`) exposes every Assistant clip tool over MCP and edits `apps/web/lib/agent/**`
  (`scope.ts`, `turn-tools.ts`, …) but not `tools.ts`, `guides.ts`, `prompt.ts` or `eval/tasks.ts`, and none of the
  packages this plan touches. When #59 merges first, `add_title` appears over MCP automatically through the shared
  tool layer; Session B checks the tool list after rebasing.
- **Security report** (PR #62): nothing here reads untrusted third-party text; titles take the founder's own words.

## Risks and containment

| Risk | Containment |
|---|---|
| Char unit is slow on long text | 200-grapheme cap → word; per-layout measure cache; export measured in E4 |
| Unit tweaks diverge between browser and Node | Pure helpers shared; parity sample `anim-units`; frames from the full export looked at |
| Estimated fit lets a long name overflow its panel | Bold factor 0.62, min scale, 60-char cap; eval and exported frame with the longest test name |
| Old documents change look | Only new optional keys; `wordSlide` / `highlightPop` / caption `pop` branches unchanged; `anim-*` parity samples must stay within thresholds |
| Title covers captions or the speaker | Placement uses the captions box; `caption-overlap`, `captions-covered`, `covers-speaker`, `text-unsafe` must be clean in tests |

## How to verify

```bash
npm run check:clip-doc && npm run test:clip-doc
npm run check:clip-render && npm run test:clip-render
npm run check:editor-core && npm run test:editor-core
npm run typecheck && npm run build
npm run parity:candidate -- … && npm run parity:compare -- --candidate <dir>   # see packages/editor-parity/README.md
cd apps/web && npm run check:contracts && npm run agent:eval -- --provider fake
cd apps/web && npm run test:e2e        # one heavy suite at a time
```

New tests: `packages/clip-render/src/text-fx.test.ts` (graphemes: "Xin chào 👋🏽" never yields a lone surrogate at
any ratio, NFD "Nguyễn" never shows a base letter without its mark; ranks for each order; random deterministic
across two calls; unit progress; mask box contains "ễ"), `packages/clip-doc` schema tests (refinements),
`packages/editor-core/src/visuals.test.ts` (longest name fits; every child inside title-safe; out shorter than in;
missing quote → `OpFailure`; moves above captions), `check.test.ts` (a text at the top edge of 1080×1920 →
`text-unsafe`; an `add_title` lower third → none).

**Look at frames (CLAUDE.md "Verify by looking").** Export a 1080×1920 clip and a 1920×1080 clip from the full-size
file (not `*.preview.mp4`), on one dark and one bright shot, with a name tag "Nguyễn Thị Hương — Founder, Episode 12"
and a chapter title; extract frames at mid build-in, mid hold, mid build-out and the first frame after out (must be
empty); plus mid reveal of each `unit` and the masked line. Check marks are not cut, numbers sit on the line, nothing
is under the platform UI zones. Attach them to the PR.

Hard budgets: no worker or pipeline change, so the 45-minute → 5 clips budget is not re-measured; E4 measures the
document export instead.

## Rollout

No database change, no migration, no deploy from the sessions. Marcus merges and deploys. The landing page is not
touched (nothing is advertised until it ships).

## Later

- `kind: 'hook'` in `add_title` replacing `add_hook_title` in `docs/style-skills-build.md`.
- Unit animations on captions (`word`/`line`), coordinated with `caption.reveal`.
- Migrate `wordSlide` documents to `slideUp + unit: 'word'` in `clip-doc/src/migrate.ts` once the equivalence test
  has held for a release.
- Selector shapes (triangle / round ramps) from Skottie's `RangeSelector` — BSD-3 notice if ported closely.
- More title looks (location pin, quote card) and per-brand presets saved in the Brand Kit.
- Variable-font weight animation; `tweenText`-style counters.
