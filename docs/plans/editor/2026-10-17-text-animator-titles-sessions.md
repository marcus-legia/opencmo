# Unit text animator + titles: work split for two sessions, one PR

Plan: [`2026-10-17-text-animator-titles-plan.md`](2026-10-17-text-animator-titles-plan.md) — read it first, all of it.
Branch: **`plan/editor/2026-10-17-text-animator-titles`** · PR: [#65](https://github.com/marcus-legia/opencmo/pull/65) (draft), shared
by both sessions.

Two Claude Code sessions build this in parallel on the same branch:

- **Session A — Text engine**: graphemes, the unit animator and masked reveal in `clip-doc` / `clip-render`, the
  inspector controls, the parity sample and the export measurement.
- **Session B — Titles**: the `add_title` builder and op, the `text-unsafe` check, the Visuals panel and transcript
  entry points, the Assistant's tool text, guide and eval.

## Rules for both sessions

1. **Own your paths.** Edit only the paths listed for your session. Need a change in the other session's paths?
   Write it under "Requests" below and let them make it.
2. **Same branch, no force.** `git pull --rebase origin plan/editor/2026-10-17-text-animator-titles` before every
   push; never `--force`; never rebase pushed commits; never push to `main`.
3. **Small commits, prefixed** `[A]` or `[B]`, English messages, each one green on its own (typecheck + the tests of
   the packages it touches). End with the attribution lines your tooling gives you.
4. **Update your checklist** in this file in the same commit that finishes an item (only your own section).
5. **Repo rules still apply** (CLAUDE.md): editor-core is the only write path; `clip-render` is the editor's only
   renderer (preview = export); no new runtime; English everywhere, including comments you touch (translate the
   Vietnamese comments in lines you edit); comments explain why; licences — learn from Skottie / anime.js /
   HyperFrames / iart-ai, write our own code; a notice in `THIRD_PARTY_NOTICES.md` only if text follows a source
   closely.
6. **Heavy suites one at a time** (`npm run build`, e2e, parity candidate rendering, `clip-export` runs).
7. **Do not deploy.** Nothing here needs Supabase or Modal changes. Marcus merges and deploys after review.
8. **Verify by looking.** Any change to text drawing or titles ends with frames extracted from the full-size export,
   looked at, and attached to the PR (plan, "How to verify").

## Shared contracts (Session A lands these first, in A1)

B codes against these from the start; A must not change them without a "Requests" note.

```ts
// packages/clip-doc/src/schema.ts (exported from @opencmo/clip-doc)
export const ANIMATION_UNITS = ['char', 'word', 'line'] as const;
export const ANIMATION_ORDERS = ['first', 'center', 'last', 'random'] as const;
export const UNIT_ANIMATION_TYPES = ['fade', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'pop', 'blur', 'grow'] as const;
// AnimationSchema: + unit?, order?, step? (0.02–0.5 s), mask? (slideUp/slideDown only); refinements per the plan.

// packages/clip-render/src/index.ts
export function graphemes(text: string): string[];
export function unitRanks(n: number, order: (typeof ANIMATION_ORDERS)[number], seed: number): number[];
export function unitProgress(t: number, rank: number, step: number, unitLength: number): number; // 0..1, not eased
// TextMetricsLike: + actualBoundingBoxAscent?: number; actualBoundingBoxDescent?: number;
```

- A1 also regenerates `packages/contracts/clip-document.schema.json`. Until A3 lands the renderer ignores `unit`
  (documents with it validate and draw as today), so B can write `unit` into titles from day one if it wants, but
  B's titles start with node-level animations (B1) and switch in B4.
- B's own contract (B lands it in B1, only B uses it): `titleInput`, `TitleInput`, `buildTitle(input, frame, area,
  duration)` in `packages/editor-core/src/visuals/title.ts`, exactly as in the plan.

## Session A — Text engine

**Owns:** `packages/clip-doc/**`, `packages/clip-render/**`, `packages/contracts/clip-document.schema.json`,
`packages/editor-parity/**`, `apps/web/components/editor/inspector/**`. Reads `packages/clip-export/**` for the
measurement but does not change it (a needed change goes to "Requests" for Marcus).

- [x] **A1 — Contracts.** The schema fields, constants and refinements; `graphemes`, `unitRanks`, `unitProgress`
      implemented (they are small and pure) and exported; `TextMetricsLike` optional fields; JSON schema regenerated.
      Accept: `npm run check:clip-doc`, `test:clip-doc` (new refinement tests: `unit` on `spin` rejected, `mask` on
      `fade` rejected, valid combos accepted), `check:clip-render`, `test:clip-render` green; existing parity
      thresholds unchanged. Push this first.
      _Done:_ helpers live in `clip-render/src/units.ts` (plus `hashSeed`, the FNV-1a seed from a node id).
      `center` ranks use `floor(|i − (n − 1)/2|)`, not `round`, so an even count starts with its two middle units
      (with `round` no unit has rank 0). No drawing change, so parity is untouched.
- [x] **A2 — Graphemes (E1).** `revealChars`, `scramble`, `typewriter` on graphemes; seed unchanged for ASCII.
      Accept: tests "Xin chào 👋🏽" (no lone surrogate at 100 ratios), NFD "Nguyễn" (no base letter without its
      combining mark), `anim-scramble` / `anim-text` parity samples still pass; one frame mid-typewriter with an
      emoji from a full-size export looked at.
      _Done:_ ASCII `scramble` output is proven identical to the old code at 101 ratios (test keeps the old function);
      whitespace graphemes (also `\n`, `\t`) now stay, where `\n` used to be scrambled into a letter. Parity: this
      machine's Skia draws 31 text frames off the references on `main` too, so A2 was checked by rendering all 70
      samples before and after on the same machine: 0 frames differ (mean 0.00, tile 0.00); CI parity stays the
      gate. Full-size 1080×1920 export of typewriter / appearChar / scramble with "👋🏽" and "Nguyễn": the emoji
      appears whole with its skin tone, scramble swaps it as one character.
- [x] **A3 — Unit animator (E2).** `r.unitFx` in `frame.ts` / `tree.ts`; `unitTweaks` in `text.ts` with char / word /
      line domains, the four orders, seeded random, default steps and durations, the 200-grapheme cap, captions
      ignored. `wordSlide` / `highlightPop` / caption `pop` unchanged. Accept: rank/progress tests per order;
      random identical across two renders; `slideUp + unit: 'word'` with `step = perWord` matches `wordSlide` within
      the parity threshold at three times; all existing parity samples pass.
      _Done:_ units ease with `wordSlide`'s cubic ease-out instead of `SOFT`, which makes `slideUp + unit: 'word'`
      pixel-identical to `wordSlide` (diff 0 at frames 3, 9, 16) and the later migration exact. `blur` runs per unit
      through `ctx.filter` on Node too (`@napi-rs/canvas` has it; a test records it), so no alpha fallback. `grow`
      and `blur` keep units visible before they start, as the node-level presets do. Letter x offsets come from
      prefix widths cached by font + text across frames. Existing samples: 0 frames differ before/after.
- [x] **A4 — Masked line reveal (E3).** Clip to the line box from `actualBoundingBox*`, fallback `fontBoundingBox*`.
      Accept: test that the mask box contains the measured box of "ễ" and "Hương"; a full-size frame mid reveal of
      "Nguyễn Thị Hương" looked at (marks intact).
      _Done:_ `lineMasks` (exported from `text.ts`) joins the font box with `actualBoundingBox*` measured at the
      draw anchor, + 0.08 em. A masked slide travels the whole line box and does not fade, so text rises from behind
      the edge. Tests: the mask contains the rendered ink of "Nguyễn", "Hương", "Nguyễn Thị Hương" and NFD "Ỗ ặ";
      mid reveal never draws outside the box. Full-size 1080×1920 export looked at: line / word / letter masks, all
      marks intact at rest.
- [x] **A5 — Inspector (E4).** "By", "Order", "Gap" (Tight/Normal/Loose), "Mask" in `inspector/parts.tsx`, shown
      only for text nodes and `UNIT_ANIMATION_TYPES`; writes through the existing inspector op path. Post the guide
      text for the new `animations` fields under "Requests" for B (B owns `guides.ts`). Accept: typecheck, an
      inspector unit test if `inspector.test.ts` covers the panel, a screenshot in the PR.
      _Done:_ "Dur" shows the default the renderer will use (`unitTiming`, exported from `clip-render`) when none is
      written; changing the type drops unit fields the new type cannot carry, so a `set_props` never makes the
      document invalid. `inspector.test.ts` tests editor-core ops, not the panel, and no e2e covers Animations, so the
      real `AnimationsSection` was bundled into a page with `edit` → editor-core `applyOps` and driven in Chromium:
      Gap → Loose writes `step` 0.088 (word), By → Letter keeps the gap (0.048), type → Fade drops `mask`, type → Spin
      drops all unit fields and hides the rows, By → Whole clears them; no op error. Not tried in the full running
      app (no Docker for local Supabase in this session); screenshot in the PR.
- [ ] **A6 — Parity + budget.** `samples/anim-units.json` + references approved by eye (README rule); export a 60 s
      1080×1920 document with 10 `unit: 'char'` text nodes through `clip-export` with `/usr/bin/time -v` before
      (main) and after; numbers in this file under A6. Accept: wall time +< 10 %, peak RSS far below 2 GB, frames
      attached.

## Session B — Titles

**Owns:** `packages/editor-core/**`, `apps/web/components/editor/visuals/**`,
`apps/web/components/editor/transcript/**`, `apps/web/lib/agent/tools.ts`, `apps/web/lib/agent/guides.ts`,
`apps/web/lib/agent/prompt.ts`, `apps/web/lib/agent/eval/tasks.ts`, `THIRD_PARTY_NOTICES.md`.

Until A1 lands, B1–B3 need nothing from A.

- [x] **B1 — Title builder.** `visuals/title.ts` per the plan (kinds, looks, side, motion factors, sizes with
      `fitSize` bold factor, 6 % title-safe, vertical UI zones, staggered in / faster reversed out, node-level
      `slideUp` for the title for now). Accept: `visuals.test.ts` — longest allowed name (60 chars) fits its panel by
      the estimate; every child inside title-safe on 1080×1920 and 1920×1080; every out animation shorter than its in;
      brand theme colors and font used.
- [x] **B2 — `add_title` op.** `BUILDERS.add_title`, `addTitle = visualOp(...)` with the `limits` argument (quote →
      hold 5.5–8 s), `REGISTRY` entry, captions-box avoidance via `createRenderer(document).layout(...)`,
      `update_visual` round trip. Accept: `ops.test.ts` / `visuals.test.ts` — quote found → times from the
      transcript; quote missing → `OpFailure` with today's message; with captions in the lower third the title sits
      above them; `update_visual {changes: {title}}` keeps position and time; golden op fixtures unchanged.
- [x] **B3 — `text-unsafe` (E6).** New code in `check.ts` from the layout box (no measurer needed). Accept:
      `check.test.ts` — text at the top edge of 1080×1920 → `text-unsafe`; an `add_title` lower third and chapter →
      no `text-unsafe`, `caption-overlap`, `captions-covered`, `covers-speaker`.
- [ ] **B4 — Titles on the unit animator (after A3 + A4).** Title text uses `slideUp` + `unit: 'word'` + `mask: true`;
      kicker band reveals with a mask. Accept: tests updated; a full-size frame mid build-in looked at on a dark and a
      bright shot.
- [ ] **B5 — Editor UI (E7).** "Title" kind in `VisualsPanel.tsx` (form + edit through `update_visual`); "Add title"
      from a transcript selection in `TranscriptPanel.tsx`. Accept: typecheck, build, a Playwright step in the
      existing editor e2e if one covers the Visuals panel (otherwise a screenshot), both flows tried in the running
      app.
- [ ] **B6 — Assistant (E8) + final look.** `tools.ts` description, `update_visual` text, `prompt.ts` mention,
      `guides.ts` paragraph (+ A's animation text from Requests), eval task `name-tag`. Then the full "Verify by
      looking" pass from the plan (both aspect ratios, dark and bright shots, all four phases, "Nguyễn Thị Hương" and
      "Episode 12"). Accept: `agent:eval -- --provider fake` green including `name-tag`; one real run
      `agent:eval -- --provider anthropic --task name-tag --yes` noted here with its cost; frames attached to the PR.

## Sync points

| When | Who | What |
|---|---|---|
| A1 pushed | A → B | B rebases; `unit`/`mask` are valid in documents |
| A3 + A4 pushed | A → B | B starts B4 |
| A5 guide text | A → B | Text for the `animations:` line in `guides.ts`, posted under Requests |
| B2 pushed | B → A | A may use `add_title` groups in the `anim-units` parity sample or the A6 export |
| Before marking ready | both | `npm run typecheck`, `npm run build`, clip-doc / clip-render / editor-core tests, parity compare, `check:contracts`, `agent:eval -- --provider fake`, e2e (one at a time); frames attached |

## Requests (append-only; `[A→B]` or `[B→A]`, date, what, status)

- **[A→B] 2026-10-16 — A3 + A4 pushed (`fe87f22`): B4 can start.** `unit` / `order` / `step` / `mask` draw in
  `clip-render`. For titles: `{ type: 'slideUp', unit: 'word', mask: true }` (default step 0.055 s, duration
  0.5 s + step × (words − 1)); out: the same with `phase: 'out'` and a shorter `duration`. A masked slide travels the
  line box and does not fade. Status: open.
- **[A→B] 2026-10-16 — guide text for the `animations:` line in `apps/web/lib/agent/guides.ts` (A5).** Append after
  the sentence on `perWord` (wording is ours, use as is or trim):
  > fade, slideUp, slideDown, slideLeft, slideRight, pop, blur and grow can run per unit on a text element:
  > {unit: "char"|"word"|"line", order?: "first"|"center"|"last"|"random", step?: seconds between two units' starts
  > (0.02–0.5; defaults 0.03 letters, 0.055 words, 0.08 lines), mask?: true (slideUp/slideDown only: each unit rises
  > from behind its line's edge instead of fading)}. Without duration it lasts 0.5 s + step × (units − 1) (0.9 s for
  > lines). Letters for short words (≲ 20 characters), words for a tagline, lines for a paragraph; text over 200
  > letters animates by word. Captions ignore unit.

  Status: open.

## How to verify before ready for review

1. Every checklist item above is ticked with its acceptance evidence in the commit or here.
2. Commands from the plan's "How to verify" are green on the branch head, run one heavy suite at a time.
3. The frames listed in the plan are attached to the PR and were looked at (marks, numbers, safe zones, empty frame
   after build-out).
4. A6's measurements are written here.
5. The PR description's "How I verified it" is updated; the PR stays a draft until Marcus reviews.
