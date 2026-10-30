# Explainer: free-form motion first, icons second — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explainers written over MCP (and by the Assistant) are drawn with scene code the model writes itself —
SVG, paths, transforms, its own curves — like the three ported Opus remakes, instead of a collage of Lucide icons
and Lotties on the blueprint field.

**Architecture:** Three things push every explainer toward icons today, and all three change:
1. The guide (`read_guide "explainer"`) tells the model to find an icon or Lottie for every noun, to put "the
   subject's icon in every beat", and its only example is icons + Headline + Board.
2. The tool schemas and the kit summary repeat it: `beats[].visual` "naming the icons, Lotties or kit shapes",
   `get_explainer_kit.read_first` "find_icons and find_lotties for every noun".
3. The preview's layout report only sees elements tagged `data-box` (kit primitives). A hand-drawn `<svg>` is
   invisible to it: the frame reads "more than 85% empty" and "Beat N shows no icon, shape or Lottie", so the
   review loop pushes the model back to icons. A new `kit.Mark` wrapper tags free-form drawings so the report sees them.

Icons, Lotties and kit shapes stay available as supporting pieces; they stop being the default.

**Tech Stack:** `packages/clip-motion` (Remotion kit, layout report, vitest), `apps/web/lib/agent` (guides, tool
schemas, eval), `packages/mcp-server` (kit summary). No SQL, no worker Python, no new dependency.

**Spec:** this plan; evidence in the investigation of 2026-10-24 (owner's flat-earth test over the claude.ai
connector looked identical to the pre-#104 output) and in
`docs/research/editor/2026-10-22-motion-quality-opus-claude-design.md`. This plan **reverses item 5 of that report**
("keep the kit as the way to draw"): the kit stays for theme, timing, text and safety, not as the drawing vocabulary.

## Global Constraints

- All code, comments, guide text and error strings in English (CLAUDE.md "Language").
- Scene code sandbox is unchanged: no new globals, no relaxation of `src/code/guard.ts`. Free-form means plain JSX
  (`div`, `svg`, `path`, `g`, CSS transforms/filters) plus `R` (`interpolate`, `spring`, `Easing.bezier`…) and `kit`.
- Code limit stays `EXPLAINER_CODE_CHARS` (32,000); previews stay `PREVIEW_LIMIT` (60/hour).
- Product rules: no identifiable real people, no other brands' logos; don't market model names.
- Peak RAM per render job < 2 GB (unchanged code path; re-measure only if Task 5 frames render slower than before).
- One branch: `plan/editor/2026-10-24-explainer-freeform-motion`, one PR to `main`. Commit only per task below.

## Review Focus

1. **A Mark that animates inside a still box** (SVG paths drawing on, a rotating group inside a fixed `Mark`) must not
   trigger "Nothing moves during beat N" — Task 1 treats `Mark` boxes like Lottie (moves inside).
2. **Two Marks with the same name** — the jump check keys on `kind:name` and skips duplicates silently; the guide must
   tell the model to give every Mark a unique name (Task 3), and a test pins that duplicates produce no false jump (Task 1).
3. **A scene with no kit primitives at all** (only Marks + `Headline`) must get a clean layout report when it is
   well laid out — Task 4's example is exactly that and is rendered in a test.
4. **The old icon flow still works**: an explainer made only of `Icon`/`Lottie`/`Shape` keeps passing (existing
   golden fixtures `showcase`, `vaccine` stay green; nothing in Task 1-2 changes their boxes).
5. **Long free-form code hitting 32,000 chars** — the guide tells the model to compute paths once above
   `return function Scene()` and reuse helpers, not to inline per-frame path strings (Task 3 copy).

---

### Task 1: `kit.Mark` — a tagged box for free-form drawing

**Files:**
- Create: `packages/clip-motion/src/kit/mark.tsx`
- Modify: `packages/clip-motion/src/kit/index.ts` (export `Mark` next to `Image`)
- Modify: `packages/clip-motion/src/layout.ts` (`MOVES_INSIDE` includes `Mark`; `beatIssues` copy)
- Test: `packages/clip-motion/src/golden.test.ts`, `packages/clip-motion/src/layout.test.ts`

**Interfaces:**
- Produces: `<Mark name: string, x: number, y: number, w: number, h: number, at?: number, dur?: number, exitAt?: number, exitDur?: number, children>` —
  same box convention as `kit.Image` (x, y = top-left in composition pixels), absolutely positioned
  `div` with `data-box="mark"` and `data-name={"Mark " + name}`, `overflow: visible`. Before `at` and after its exit
  it renders nothing (same contract as every kit component). It adds **no** entrance motion of its own beyond the
  fade the other primitives use for `exitAt`/`exitDur`: the author's code owns the motion.
- Produces: `beatIssues` message `Beat ${n} shows nothing drawn: draw what its narration names (a Mark you draw, a shape, an icon).`

- [ ] **Step 1: Write the failing tests**
  - `golden.test.ts`, `describe('kit.Mark')`:
    - `it('reports its box as a mark with the given name')`: scene
      `<Stage><Mark name="disc" x={400} y={200} w={500} h={300} at={0}><svg width="100%" height="100%"><ellipse cx="250" cy="150" rx="240" ry="140" fill="#f5b700"/></svg></Mark></Stage>`
      on a 16:9 3 s clip job (reuse the `kit.Image` job helper without assets); still at frame 45 →
      `expect(still.boxes).toContainEqual({ kind: 'mark', name: 'Mark disc', x: 400, y: 200, w: 500, h: 300 })`,
      and the pixel at the box centre (quarter scale) has `r > 200`.
    - `it('renders nothing before at')`: same scene with `at={60}`, still at frame 30 → no box named `Mark disc`.
  - `layout.test.ts`:
    - `beatIssues` with two samples of one beat, each `[{ kind: 'mark', name: 'Mark disc', x: 0, y: 0, w: 100, h: 100 }]`
      (identical) → `[]` (moves inside, no "Nothing moves").
    - `beatIssues` with a beat whose only box is a `Board` → message equals
      `Beat 1 shows nothing drawn: draw what its narration names (a Mark you draw, a shape, an icon).`
    - `jumpIssues` with two `Mark ship` boxes in frame a and one far away in frame b → `[]` (duplicates skipped).

- [ ] **Step 2: Run** `npm run check:clip-motion` → the new tests FAIL (`Mark` is undefined / old message).

- [ ] **Step 3: Implement** `Mark` in `kit/mark.tsx`, reusing the visibility/exit helper `image.tsx` uses; add `Mark`
  to the kit object in `kit/index.ts` under a `// Free-form drawing` comment; in `layout.ts` extend `MOVES_INSIDE`
  to `/^(DotField|Spectrogram|Waveform|Lottie\b|Shape blob|Mark\b)/` and change the `beatIssues` message.

- [ ] **Step 4: Run** `npm run check:clip-motion` → PASS, including the unchanged `showcase` and `vaccine` goldens.

- [ ] **Step 5: Commit** `git commit -m "Motion kit: Mark tags free-form drawings for the layout report"`

### Task 2: Preview checklist and fixes speak about drawings, not icons

**Files:**
- Modify: `packages/clip-motion/src/preview.ts` (any review-checklist line or issue text that says icon/Lottie as the subject)
- Modify: `apps/web/lib/agent/guides.ts` §4 bullet `"more than 85% empty" or "beat N shows no icon, shape or Lottie"`
- Test: `packages/clip-motion/src/layout.test.ts` (already covers the message), `apps/web/lib/agent/agent-design.check.ts`

**Interfaces:**
- Consumes: the Task 1 message text verbatim.

- [ ] **Step 1: Add to `agent-design.check.ts`** (it already imports `readGuide`):
  `assert.ok(readGuide("explainer").includes('"beat N shows nothing drawn"'))` and
  `assert.ok(!/shows no icon, shape or Lottie/.test(readGuide("explainer")))`.
- [ ] **Step 2: Run** `cd apps/web && npm run check:contracts` (or the script that runs `agent-design.check.ts`;
  find it with `grep -n agent-design apps/web/package.json`) → FAIL.
- [ ] **Step 3:** Update the §4 bullet to `"more than 85% empty" or "beat N shows nothing drawn" → draw the beat's
  subject bigger, as a Mark`. Grep `preview.ts` for `icon` in user-facing strings and reword the same way.
- [ ] **Step 4: Run** the same check + `npm run check:clip-motion` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Explainer review: report missing drawings, not missing icons"`

### Task 3: Rewrite the explainer guide around drawing the subject

**Files:**
- Modify: `apps/web/lib/agent/guides.ts` (`explainer` entry, lines ~304-410)
- Modify: `apps/web/lib/agent/motion-guide.ts` (`EXPLAINER_MOTION`: add the curve/overshoot/blur recipe lines)
- Modify: `apps/web/lib/agent/explainer-tool.ts:61` (`visual` describe)
- Modify: `packages/mcp-server/src/groups/explainer.ts:91` (`read_first`) and `packages/mcp-server/src/groups/guides.ts:133`
  (`kit-explainer` resource description)
- Test: `apps/web/lib/agent/agent-design.check.ts`, `packages/mcp-server/src/server.check.ts`

**Interfaces:**
- Consumes: `Mark` (Task 1). Produces: guide text Task 4 inserts its example into via `${EXPLAINER_EXAMPLE}`.

Decisions the copy must carry (wording is the implementer's, these facts are fixed):
- Opening paragraph: every beat SHOWS what its narration names, **drawn in the scene code** (SVG shapes and paths,
  CSS transforms, the model's own curves) inside a `Mark`; icons, Lotties and kit shapes are for small supporting
  details or when a standard symbol is the clearest picture.
- Storyboard step 2 becomes: for each noun, decide how to DRAW it (its silhouette in 2-4 SVG primitives, its colour
  from `kit.color`, how it moves). `find_icons` / `find_lotties` only for a supporting symbol (a check, a clock).
- `visual` example in the guide and in `explainer-tool.ts`:
  `"a flat disc tilts 30° to show its edge; a dashed horizon line draws across it; a ship sinks hull-first below the curve"`.
- New subsection "Draw it yourself" in §3, before "Things to draw":
  - `<Mark name x y w h at exitAt>` wraps every drawing; unique `name` per Mark (the jump check matches by name).
  - Motion recipes (from the ported templates, with the template path as the reference to read):
    `R.Easing.bezier(x1, y1, x2, y2)` for named curves and capped overshoot (`packages/clip-motion/templates/phone-carousel/scene.jsx`);
    speed-linked blur (`filter: blur(${k * speed}px)`, peak 4 px); stroke draw-on with `strokeDasharray`/`strokeDashoffset`;
    morph between two paths with `kit.morph`; a slow camera via `Camera`.
  - Compute geometry once above `return function Scene()`; keep code under 32,000 characters.
- Remove: "The subject's icon in every beat" (Do list), "drawn with icons, built-in Lottie animations or kit shapes"
  (intro), and `read_first` item `"find_icons and find_lotties for every noun of the narration"` → replace with
  `"draw each beat's subject yourself in a Mark (read the 'Draw it yourself' section); find_icons / find_lotties only for supporting symbols"`.
- `EXPLAINER_MOTION`: add one bullet: "Use the personality's curve for entrances; for the primary move of a beat write
  your own (`Easing.bezier`), with an overshoot capped at about 3% of the move and a settle."

- [ ] **Step 1: Add checks** to `agent-design.check.ts`: the explainer guide contains `<Mark`, `Easing.bezier`,
  `strokeDashoffset`, `templates/phone-carousel/scene.jsx`; does NOT contain `The subject's icon in every beat` or
  `icons, built-in Lottie animations or kit shapes`. In `server.check.ts`: `get_explainer_kit` `read_first` contains
  `"in a Mark"` and no string contains `for every noun of the narration`.
- [ ] **Step 2: Run** `cd apps/web && npm run check:contracts` and `npm run check:mcp-server` → FAIL.
- [ ] **Step 3:** Edit the files above.
- [ ] **Step 4: Run** both checks again → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `git commit -m "Explainer guide: draw the subject in a Mark; icons are supporting pieces"`

### Task 4: One free-form example scene, rendered in a test, used by the guide

**Files:**
- Create: `packages/clip-motion/src/guide-example.ts` exporting `EXPLAINER_EXAMPLE: string` (scene body) and
  `EXPLAINER_EXAMPLE_BEATS: { say: string; label: string; visual: string }[]` (3 beats)
- Modify: `packages/clip-motion/src/index.ts` (re-export both)
- Modify: `apps/web/lib/agent/guides.ts` (replace the icon-only "Example:" block with `${EXPLAINER_EXAMPLE}`)
- Test: `packages/clip-motion/src/golden.test.ts`

**Interfaces:**
- Produces: `EXPLAINER_EXAMPLE` — a narrated, 9:16, 3-beat scene that uses only `Stage`, `Headline`, `Mark`,
  `Camera` and `R` (no `Icon`, no `Lottie`). Topic fixed so it is reusable and fact-safe: **"Why the sea looks flat"**
  (beat 1: a disc of sea under a horizon line; beat 2: the camera pulls back and the line bends into a curve of a
  much larger circle; beat 3: a ship sails away and sinks hull-first below the curve). At least one move uses
  `Easing.bezier` with capped overshoot and one path draws on with `strokeDashoffset`.

- [ ] **Step 1: Write the failing test** `describe('guide example')`:
  `it('renders with a clean layout report', { timeout: 240_000 })`: build a narrated job from
  `EXPLAINER_EXAMPLE` + `EXPLAINER_EXAMPLE_BEATS` (format `9:16`), run the same preview path `preview.ts` uses
  (stills at each beat midpoint + `probeFrames`), and assert `issues` (layout + beat + jump) is `[]` and every beat has
  a box whose name starts with `Mark `.
- [ ] **Step 2: Run** `npm run check:clip-motion` → FAIL (module missing).
- [ ] **Step 3:** Write the scene; iterate with the clip-motion CLI (`packages/clip-motion/src/cli.ts`) until the stills
  look like the template quality bar (look at them — CLAUDE.md "Verify by looking"); wire it into the guide.
- [ ] **Step 4: Run** `npm run check:clip-motion`, `cd apps/web && npm run check:contracts` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Explainer guide: a free-form example scene, rendered in a test"`

### Task 5: Eval and the before/after frames

**Files:**
- Modify: `apps/web/lib/agent/eval/tasks.ts:161-171` (`drawable`)
- Create: `docs/plans/editor/2026-10-24-explainer-freeform-frames/{before,after}/` (PNG stills)
- Test: `apps/web/lib/agent/eval/run.ts` fake run (`npm run eval:agent -- --fake` or the script `run.ts` documents)

**Interfaces:**
- Produces: `drawable(visual: string, code: string): boolean` — true when the old icon/Lottie/shape rule holds OR
  `code` contains a `<Mark name="…">` whose name (split on `-`/space) shares a word with `visual`.

- [ ] **Step 1:** Change the explainer task's grade to call `drawable(beat.visual, code)`; add a fake-provider case whose
  storyboard says `"a flat disc tilts"` and whose code has `<Mark name="disc"` → graded drawable.
- [ ] **Step 2: Run** the fake eval → the new case FAILS before the change, PASSES after; the existing 41 fake cases stay green.
- [ ] **Step 3: Before/after frames.** Run the owner's test prompt ("make a 9:16 explainer: what if the earth is flat?")
  through a local MCP client against `npm run dev` on `main` (before) and on this branch (after); save the preview
  stills of both. Look at them side by side. The after set must show drawn subjects, not icon medallions; if it does not,
  go back to Task 3's copy before opening the PR.
- [ ] **Step 4: Commit** `git commit -m "Eval: free-form Marks count as drawn; before/after explainer frames"`

## How to verify (end of plan)

- `npm run typecheck && npm run build`; `npm run check:clip-motion`; `npm run check:mcp-server`;
  `cd apps/web && npm run check:contracts`; fake eval green.
- Frames in `docs/plans/editor/2026-10-24-explainer-freeform-frames/`, looked at, side by side in the PR.

## Deploy (owner, after merge — order matters)

The guide, tool schemas and kit live in three runtimes; each must be redeployed or the change does not reach users
(the #104 MCP server stayed on the 2026-10-20 build until 2026-10-24 because step 2 was missing from its plan):
1. Worker: `cd packages/engine && .venv312/bin/modal deploy modal_app.py` (MotionPreview and the render use the kit with `Mark`).
2. MCP: `npm run build --workspace @opencmo/mcp-server && cd packages/engine && .venv312/bin/modal deploy mcp_app.py`;
   then `modal container list` and stop any `opencmo-mcp` container older than the deploy.
3. Web: Vercel deploys on merge (in-app Assistant guide).
4. In claude.ai: reconnect the opencmo connector and start a new chat (old chats keep the old tool schemas).

## Not in this plan

- New kit helpers beyond `Mark` (a bezier helper, a blur helper): `R.Easing.bezier` and plain CSS cover them; add one
  only if Task 4 shows the code limit is tight.
- Narrated explainers built on the three templates (template slots in a narrated scene): decide after Task 5's frames.
- Adding the MCP deploy step to a shared deploy checklist / CLAUDE.md: note in the PR; separate change.
