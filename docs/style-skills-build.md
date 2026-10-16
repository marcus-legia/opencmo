# Style skills: build plan (3 parallel sessions)

One branch (`claude/video-editing-review-hrrmqx`), one draft PR, three Claude sessions working in parallel.
This file is the plan only; no code ships with it.

## Why

A reference reel (2026-10-16, "5 Plugins To Code Like A Senior Dev", 12 s) shows the talking-head format our
users want, and today's editor can't reproduce it. Frame by frame, here is what it does and what we're missing:

| In the reel | We have | Missing |
|---|---|---|
| Two-line hook title; line 2 in an italic serif on an accent box; stays up through the intro | `add_text`, `pop`/`appearWord` | A hook-title op with an accent box; the agent has to build it by hand every time |
| Captions show 1–2 words at a time; **chosen keywords** get italic serif or the accent colour; each word fades in from grey | Presets, `maxWords`, `highlight: block\|pop` (current word only) | **Keyword emphasis** (picked words, not the current word); fade-in reveal |
| Split frame: the speaker at the bottom, a numbered list of 5 repos with star counts at the top, names blurred, numbers light up 1→5 in time with the speech | `split-top` layout, shapes, text | A **list that reveals in time with speech**, with blurred cells |
| GitHub page in a browser frame slides in, zooms to "24 lifecycle skills" and marks it in time with "of 24" | Nothing | **Proof B-roll**: capture a URL → browser card → zoom and highlight the spoken phrase |
| Punch-in zoom changes between speaker cuts | Face tracking, reframe | **Alternating punch-in** per cut |
| Whip transition with motion blur between chapters | `dissolve`, `slide*`, `fade*`, a `blur` effect | `whip` transition |
| One accent colour on white, two fonts, throughout | Brand kit (accent, caption preset) | A **style** that pins all of the above together |

Each of these is a recipe ("skill") the agent could follow, but it can only follow it once the code has the
building blocks. Today the three places called "skills" (`apps/web/lib/cmo/skills` playbooks, the built-in guides in
`apps/web/lib/agent/guides.ts`, and user recipes in `editor_skills`) are all prose for the LLM. None of them
records which code a recipe needs, so we can't tell which recipes actually work.

## Goal and acceptance test

Three layers, each with one owner:

1. **Capabilities**: deterministic, tested building blocks in `clip-doc` / `editor-core` / `clip-render` (and the
   worker for captures). No taste lives here.
2. **Style skills**: data. A style is markdown with frontmatter: `requires` (the capabilities it needs), `preset`
   (machine-applied values) and a body (judgment the LLM applies: which words, which hook, which proof).
3. **Director**: the editor assistant reads a style, writes an **Edit Plan** (anchored to quotes from the
   transcript, never to seconds) in one structured step, and `apply_style` compiles the plan into ops as one
   revision.

**Acceptance (the owner runs it on production at the end).** Upload a 60–90 s talking head of yourself that mentions a
public GitHub repo and a number from its README, then:

```
/style senior-dev-listicle
```

The exported clip (frames taken from the full-size file, not `*.preview.mp4`) shows:

- a two-line hook title in the first 2–3 s, line 2 on the accent box, not covering the face or the captions;
- captions 1–2 words at a time, with at most one emphasized word per 2 s, every emphasized word a number, a name
  or a promise;
- a punch-in that alternates between cuts, with the face still fully inside the frame (look at it);
- one proof card: the repo page in a browser frame that zooms to and marks the number while the speaker says it;
- a `whip` between chapters if the plan has chapters;
- **one** Undo reverts the whole style; the assistant's receipt lists anything it skipped and why.

Budgets: `apply_style` runs in < 300 ms on the document (no worker). Export of the styled clip is measured with
`/usr/bin/time -v` and stays under 2 GB peak. A page capture finishes in < 20 s.

## Decisions

- **Quotes, not seconds.** Every beat of the Edit Plan anchors to exact words from the transcript, resolved with the
  existing `quoteRange` / `resolveTiming` (`packages/editor-core/src/ops/visuals.ts`). An LLM quotes well and
  times badly. A quote that is not found becomes a skipped item in the receipt, never a guess.
- **One revision, one undo.** `apply_style` runs every sub-op inside one revision, the way `edit_video` places its
  result. Validation happens before anything is written.
- **Composition before schema.** A new node kind is the last resort. The proof card is a group of existing nodes
  (image + rect + text + mask) with tracks; the list is text rows + rects with tracks. Only captions (`emphasis`,
  `reveal`) and transitions (`whip`) change the schema, because the renderer must draw them.
- **Capabilities are a registry, not prose.** `packages/editor-core/src/capabilities.ts` lists every capability id
  with `ready: boolean` and the ops behind it. A style whose `requires` are not all ready is hidden from the
  agent; `npm run skills:gaps` prints what is missing. That list is the backlog. It also enforces "don't ship
  coming soon".
- **Styles live in a new data package** `packages/skills` (markdown + generated index), the library we keep
  growing. The CMO playbooks get a `kind: playbook` in their frontmatter but **do not move** in this PR; the
  built-in guides stay in `guides.ts`. Both are noted in Out of scope.
- **Page captures run in a separate Modal function with no secrets.** A captured page runs arbitrary JavaScript in
  Chromium; that process must not share a container with `OPENCMO_WORKER_TOKEN` (same reasoning as the explainer
  preview token, `docs/explainer-v2-build.md` B5). The worker task calls it and does moderation and upload.
- **Captures are free, capped**: 30 per user per day, enforced in the RPC, cached per user by normalized URL for
  24 h. No credits move, so no `credit_hold`.
- **Captured pixels are never altered by AI.** The browser frame shows the real URL. Screenshots go through
  image moderation before upload. This is quoting a public page, like a screen share; the owner can veto before
  merge.

## Contracts (fixed; change only through a Request)

### Capability registry (`packages/editor-core/src/capabilities.ts`, Track A creates it; B and C flip only their own lines)

```ts
export const CAPABILITIES = {
  'caption.emphasis':  { track: 'B', ready: false, ops: ['emphasize_words'] },
  'caption.reveal':    { track: 'B', ready: false, ops: ['set_props'] },
  'title.hook':        { track: 'B', ready: false, ops: ['add_hook_title'] },
  'speaker.punchIn':   { track: 'B', ready: false, ops: ['punch_in'] },
  'list.reveal':       { track: 'B', ready: false, ops: ['add_list'] },
  'transition.whip':   { track: 'B', ready: false, ops: ['set_props'] },          // transition on the left clip
  'layout.split':      { track: 'B', ready: true,  ops: ['set_layout'] },
  'proof.capture':     { track: 'C', ready: false, ops: [] },            // tool capture_page
  'proof.card':        { track: 'C', ready: false, ops: ['add_proof'] },
} as const;
export type Capability = keyof typeof CAPABILITIES;
```

A check (Track A) fails when an op named here is not in `REGISTRY`, or when a capability is `ready` but its ops are
missing. Op names above are final; existing ops keep their current names (check them when writing the file and fix
this table if one differs).

### Skill file (`packages/skills/<kind>/<name>.md`, Track A)

```yaml
---
name: senior-dev-listicle          # kebab-case, unique across all kinds
kind: style                         # style | playbook | guide
description: Talking head with on-screen proof, one accent colour, listicle chapters.  # when to use it
requires: [caption.emphasis, title.hook, speaker.punchIn, proof.card, transition.whip]
preset:                             # style only; validated by StylePresetSchema
  captions: { preset: spotlight, maxWords: 2, reveal: fade, emphasis: { fontFamily: Fraunces, fontStyle: italic, color: accent } }
  hookTitle: { accentLine: 2, accentBox: true, accentFontFamily: Fraunces, accentFontStyle: italic, seconds: 3 }
  speaker: { punchIn: { scales: [1.0, 1.15], minShot: 1.2 } }
  chapters: { transition: whip }
  proof: { zoom: 1.8, mark: marker }
  palette: { accent: brand, paper: '#FFFFFF', ink: '#111111' }
---
# When to emphasize
...
```

`scripts/build-skills.mts` in `packages/skills` generates `src/index.gen.ts` (`{ name, kind, description, requires,
preset, body }[]`); `--check` fails when the generated file is stale, a `requires` id is unknown, or a `preset` fails
the schema.

### `StylePresetSchema` (`packages/editor-core/src/style/preset.ts`, Track A)

Every key optional; `accent`/`brand` resolve to the clip's brand kit accent.

```ts
const colorRef = z.union([hex, z.enum(['accent', 'ink', 'paper'])]);
export const StylePresetSchema = z.object({
  captions: z.object({
    preset: z.enum(CAPTION_PRESETS).optional(),
    maxWords: z.number().int().min(1).max(6).optional(),
    highlight: z.enum(['block', 'pop']).nullable().optional(),
    reveal: z.enum(['fade']).optional(),
    emphasis: z.object({ fontFamily: z.string().optional(), fontStyle: z.enum(['normal', 'italic']).optional(),
                         color: colorRef.optional(), scale: z.number().min(1).max(1.6).optional() }).strict().optional(),
  }).strict().optional(),
  hookTitle: z.object({ accentLine: z.union([z.literal(1), z.literal(2)]).optional(), accentBox: z.boolean().optional(),
                        fontFamily: z.string().optional(), accentFontFamily: z.string().optional(),
                        accentFontStyle: z.enum(['normal', 'italic']).optional(), seconds: z.number().min(1).max(8).optional() }).strict().optional(),
  speaker: z.object({ punchIn: z.object({ scales: z.tuple([z.number().min(1).max(1.5), z.number().min(1).max(1.5)]),
                                          minShot: z.number().min(0.3).max(10) }).strict().optional() }).strict().optional(),
  chapters: z.object({ transition: z.enum(TRANSITION_TYPES).optional() }).strict().optional(),
  proof: z.object({ zoom: z.number().min(1).max(3).optional(), mark: z.enum(['marker', 'box']).optional() }).strict().optional(),
  palette: z.object({ accent: z.union([hex, z.literal('brand')]).optional(), paper: hex.optional(), ink: hex.optional() }).strict().optional(),
}).strict();
```

### Edit Plan (`packages/editor-core/src/style/plan.ts`, Track A)

What the assistant writes after reading a style. Quotes are exact transcript words, as `quoteRange` requires.

```ts
export const EditPlanSchema = z.object({
  style: z.string(),                                                  // skill name
  hook: z.object({ lines: z.array(z.string().trim().min(1).max(40)).min(1).max(2) }).optional(),
  emphasis: z.array(z.object({ quote: z.string().min(1).max(60) })).max(40).default([]),
  chapters: z.array(z.object({ quote: z.string().min(1).max(200), title: z.string().max(40).optional() })).max(10).default([]),
  list: z.object({
    quote: z.string(),                                                // when the list appears
    items: z.array(z.object({ label: z.string().max(40), meta: z.string().max(16).optional(), blur: z.boolean().optional() })).min(2).max(7),
    reveal: z.array(z.object({ quote: z.string() })).max(7).optional(), // one per item, in order
  }).optional(),
  proofs: z.array(z.object({
    capture_id: z.string(),                                           // a finished capture (Track C)
    quote: z.string().min(1).max(200),                                // when the card shows
    focus: z.string().min(1).max(120),                                // text on the page to zoom to and mark
  })).max(6).default([]),
}).strict();
```

### Op `apply_style` (`packages/editor-core/src/style/apply.ts`, Track A)

Input `{ op: 'apply_style', style: string, plan: EditPlan }`. Resolves every quote and every capture before writing.
Then, in one revision: preset → captions props; `emphasize_words`; `add_hook_title`; `punch_in`; `add_list`;
chapter transitions; `add_proof`. It calls the ops' exported functions, not the agent tools. Receipt:

```ts
{ applied: string[]; skipped: { item: string; reason: string }[]; unavailable: Capability[] }
```

A capability that is not `ready` lands in `unavailable` and is skipped. That is not an error: the style degrades.

### New ops (Track B, `packages/editor-core`)

| Op | Input | Writes |
|---|---|---|
| `emphasize_words` | `{ element_id?, quotes: string[], clear?: boolean }` | Source-time ranges into the captions layer's `emphasis` |
| `add_hook_title` | `{ lines: string[1..2], start?, end?, quote? }` | A group (text rows + accent rect) in the upper third, clear of captions; animation in/out |
| `punch_in` | `{ scales?: [n, n], min_shot?: n }` | Scale track on the speaker per cut segment, recentred on the face track; idempotent (rerun replaces) |
| `add_list` | `{ items, quote? \| start/end, reveal_quotes?: string[] }` | A group of rows in the visual panel; per-row highlight tracks; blur effect on `blur` items |
| transition `whip` | `set_props { transition: { type: 'whip' } }` on the left clip (existing op) | Renderer: shift + directional motion blur, 0.25 s default |

### Captions schema additions (`packages/clip-doc/src/schema.ts`, Track B)

```ts
// CaptionsSchema
emphasis: z.array(z.object({ start: num, end: num }).strict()).max(500).optional(), // SOURCE seconds, same time base as removed words, so cuts don't break it
emphasisStyle: z.object({ fontFamily: z.string().min(1).max(80).optional(), fontStyle: fontStyle.optional(),
                          color: color.optional(), scale: z.number().min(1).max(1.6).optional() }).strict().optional(),
reveal: z.enum(['fade']).optional(),  // each word fades in from a muted ink as it is spoken
// TRANSITION_TYPES gains 'whip'
```

Add a migration step in `packages/clip-doc/src/migrate.ts` only if the document version must change; adding optional keys must not change the version.

### Page capture (Tracks C and A)

- Task kind `capture_page` in `packages/contracts/task-kinds.json`. Spec: `{ url: string, width: 1280, max_height: 8000 }`.
- RPC `capture_create(p_url text) returns uuid` (ownership, the 30/day limit, returns a cached capture id when the
  same user captured the same normalized URL < 24 h ago). Route `POST /api/v1/captures` → RPC; `GET
  /api/v1/captures/:id` → `{ status: 'pending'|'ready'|'failed', error?, image_url?, boxes_url? }` (signed URLs).
- Output in storage: `page.png` (device scale 2) and `page.boxes.json`:

```json
{ "url": "https://github.com/…", "title": "…", "width": 1280, "height": 5120, "scale": 2,
  "runs": [{ "text": "24 lifecycle skills", "rect": [412, 1880, 230, 28] }] }
```

  `runs` are text nodes split at word boundaries, in CSS pixels; `add_proof` finds `focus` across consecutive runs.
- Errors written to `jobs.error` / the task, in English, and short: "That page could not be opened.",
  "That address is not allowed.", "That page is too large to capture.", "This page did not pass the content check."
- Agent tool `capture_page { url }` (Track A wires it in `apps/web/lib/agent`) returns `{ capture_id, status }`;
  `capture_status { capture_id }` polls. `add_proof { capture_id, focus, quote }` (Track C op) needs status `ready`.

## How the three sessions work together

1. **Branch.** Everyone works on `claude/video-editing-review-hrrmqx`. Before every task and every push, run
   `git pull --rebase origin claude/video-editing-review-hrrmqx`. Never force-push.
2. **Ownership.** Edit only your own files (table below). Need something in another track's file? Add a line under
   [Requests](#requests) and keep going.
3. **Contracts first.** Track A's first push: `capabilities.ts`, `StylePresetSchema`, `EditPlanSchema` (types and
   schemas only), the skill frontmatter schema. Track B's first push: the captions schema keys and `whip` in
   `TRANSITION_TYPES` (renderer may ignore them at first). Track C's first push: `capture_page` in task kinds plus the
   migration. Until then, code against the contracts above.
4. **Small commits:** `style-skills B2: keyword emphasis in captions`. English only.
5. **Tick your own boxes** and add a line under your Notes in the same commit.
6. **Green before push:** `npm run typecheck` plus your track's checks. A red push blocks the other two.
7. **Verify by looking** (`CLAUDE.md`). Extract frames from full-size exports and look at them. Say in Notes what each
   frame shows.
8. **Project rules hold:** writes through ownership-checking RPCs; every migration has a pgTAP test, then
   `scripts/dump-schema.sh`; user-facing errors in English; no "coming soon"; peak RAM per job < 2 GB; user media
   and captured pages are untrusted.

| Track | Owns |
|---|---|
| **A: Skill library & director** | `packages/skills/**` (new), `packages/editor-core/src/style/**`, `packages/editor-core/src/capabilities.ts` (B and C flip their own lines), `apps/web/lib/agent/**`, `apps/web/lib/cmo/skills/**` (frontmatter only), `scripts/build-cmo-skills.mts` |
| **B: Editing capabilities** | `packages/clip-doc/**`, `packages/clip-render/**`, `packages/clip-export/**`, `packages/editor-parity/**`, `packages/editor-core/src/**` except `style/**`, `proof/**`, `capabilities.ts`; `apps/web/components/editor/**` |
| **C: Proof B-roll** | `packages/engine/**`, `packages/contracts/**`, `supabase/**`, `packages/editor-core/src/proof/**` (new), `apps/web/app/api/v1/captures/**` (new), `apps/web/lib/capture/**` (new) |

`apps/web/lib/agent/guides.ts` belongs to A, but B writes the new paragraphs of the `captions`, `hooks` and `motion`
guides and C writes a new `proof` guide. Edit only your own section. `packages/editor-core/src/ops/index.ts`
(registry): B and C each add only the lines for their own ops.

---

## Track A: Skill library & director

- [x] **A1. Contracts.** `capabilities.ts`, `style/preset.ts`, `style/plan.ts`, and the skill frontmatter zod in
  `packages/skills/src/format.ts`. Unit tests: the example preset and plan above parse; unknown keys fail.
  **Push this first.**
- [x] **A2. `packages/skills` package.** Workspace package, `styles/` folder, `scripts/build-skills.mts` →
  `src/index.gen.ts`, `--check` wired into `check:contracts`. Check rules: unique names, `requires` ids exist in
  `CAPABILITIES`, `preset` passes `StylePresetSchema`, body ≤ 12k chars.
- [x] **A3. Capability check.** `capabilities.check.ts`: every op named in `CAPABILITIES` exists in `REGISTRY` when
  `ready`; `npm run skills:gaps` prints, per style, the capabilities it still waits for.
- [x] **A4. First style `senior-dev-listicle`.** Preset as in the contract. The body covers: what to emphasize
  (numbers, names, promises; ≤ 1 per 2 s; never filler), how to write the hook (the speaker's strongest phrase,
  3–8 words, line 2 is the promise), when a claim earns a proof (a number, a repo, a person's title), chapters for
  "number one/two…". No copied text from the reference reel.
- [x] **A5. `apply_style` op.** Resolve → validate → one revision → receipt, exactly as the contract says. Tests in
  `style/apply.test.ts`: a plan with a missing quote is skipped and reported; an unready capability shows up in
  `unavailable`; a second run replaces the first (no duplicate titles, emphasis or punch-ins); one undo restores the
  document byte-for-byte (compare JSON).
- [x] **A6. Assistant wiring.** `<styles>` index in the context (ready styles only; name + description), `read_skill`
  reads styles too, `/style <name>` slash command (`slash.ts`), tools `capture_page` and `capture_status` calling
  C's routes (code against the contract until C2 lands), `apply_style` exposed through `AGENT_OP_INPUTS`. The
  directive: read the style, capture any proof URLs first, wait for `ready`, then write the plan and call
  `apply_style` once, then run `check` and capture a frame at the hook and at each proof.
- [x] **A7. CMO playbooks get `kind: playbook`** in frontmatter through `build-cmo-skills.mts`; no file moves.
- [x] **A8. Evals.** `style-listicle` in `apps/web/lib/agent/eval` with the fake provider: the grader wants one
  `apply_style` call, every quote present in the transcript, emphasis ≤ 1 per 2 s, hook ≤ 8 words per line, proofs
  only with ready captures, and the receipt reported to the user (including skipped items).

**Checks:** `npm run typecheck`; `npm run check:contracts --workspace @opencmo/web`; editor-core tests;
`npm run agent:eval --workspace @opencmo/web -- --provider fake`.

## Track B: Editing capabilities

- [ ] **B1. Schema.** Captions `emphasis`, `emphasisStyle`, `reveal`; `whip` in `TRANSITION_TYPES`; regenerate
  `packages/contracts/clip-document.schema.json` with `packages/clip-doc/scripts/json-schema.ts` (B may commit that
  generated file). **Push this first.**
- [ ] **B2. Keyword emphasis.** `clip-render/src/captions.ts` draws emphasized words with `emphasisStyle` (font,
  italic, colour, scale) in every preset, without breaking line width (measure with the emphasized font). Op
  `emphasize_words` resolves quotes to source-time ranges; removing words keeps the rest. Tests: emphasis survives a
  cut; a quote not in the transcript fails with the existing quote error. Flip `caption.emphasis`.
- [ ] **B3. Reveal.** `reveal: 'fade'` fades each word from 35% ink to full ink over 120 ms at its start. Flip
  `caption.reveal`.
- [ ] **B4. Hook title.** `add_hook_title`: group of 1–2 text rows; the accent line sits on a rounded accent rect sized
  from the measured text; upper third; `check` reports caption overlap as today. `pop` in, fade out. Flip
  `title.hook`.
- [ ] **B5. Punch-in.** `punch_in` writes a scale track on the speaker that alternates `scales` at each cut boundary
  (cuts from the captions model; shots shorter than `min_shot` keep the previous scale), recentred on the face
  track so the face never leaves the frame. Rerun replaces. Flip `speaker.punchIn`.
- [ ] **B6. List.** `add_list`: rows with index, label and optional meta in the visual panel (works with
  `split-top`/`split-bottom`); each row highlights at its `reveal_quotes` time; `blur: true` items get the blur
  effect on the label only. Flip `list.reveal`.
- [ ] **B7. Whip.** Renderer: the outgoing clip shifts out and the incoming one shifts in, with directional motion blur
  (sampled, at most 6 taps), 0.25 s default. Browser and export draw the same frames: add an `editor-parity` sample.
  Flip `transition.whip`.
- [ ] **B8. Editor UI.** In the transcript panel, select words → "Emphasize" / "Remove emphasis" (calls
  `emphasize_words`); the captions inspector gets an emphasis style section and the reveal toggle. Guides: new
  paragraphs in `captions`, `hooks`, `motion`.
- [ ] **B9. Look and measure.** Export a 60 s clip with all of B2–B7; look at 8 full-size frames (hook, an emphasized
  word, both punch-in scales, the list mid-reveal, the whip midpoint); `/usr/bin/time -v` peak RSS < 2 GB; Notes.

**Checks:** `npm run typecheck`; clip-doc, clip-render, editor-core tests; `editor-parity` render;
`npm run test:e2e -- editor-captions`.

## Track C: Proof B-roll

- [x] **C1. Migration** `supabase/migrations/<ts>_page_captures.sql` + pgTAP test: `page_captures` table (owner,
  normalized URL, status, error, storage paths, created_at) under RLS; `tasks_kind_check` gains `capture_page`;
  RPC `capture_create` (ownership, URL length ≤ 2048, http/https only, 30/day, 24 h cache);
  `scripts/dump-schema.sh`. Task kind in `task-kinds.json`. **Push this first.**
- [x] **C2. Routes.** `POST /api/v1/captures` (zod → RPC) and `GET /api/v1/captures/:id` (read under RLS, signed URLs).
  `check:api` contract updated.
- [x] **C3. Capture function.** A Modal function `page_capture` with **no secrets**, Chromium via Playwright, one page per
  call: `width` 1280 viewport, device scale 2, 15 s navigation timeout, full-page screenshot capped at `max_height`,
  then `runs` from the DOM (text nodes split into words with `Range.getClientRects`). Every request (document,
  subresource, redirect, websocket) goes through interception that allows only http/https on default ports and
  resolves the host, rejecting private, loopback, link-local and metadata addresses (port the rules of
  `apps/web/lib/cmo/site.ts` to Python). No downloads, no cookies kept, no permissions granted. Measure the image
  size, cold start, warm capture time and peak RSS (Notes).
- [x] **C4. Worker task.** `opencmo/worker/capture_page_task.py`: calls `page_capture`, runs the PNG through
  `opencmo/ai/moderation.py`, uploads `page.png` + `page.boxes.json`, marks the capture ready; English errors from
  the contract. Tests with a local HTTP fixture page (served by the test); SSRF tests: `127.0.0.1`, `169.254.169.254`,
  a redirect to a private IP, a subresource on a private IP: all blocked.
- [ ] **C5. Op `add_proof`.** `packages/editor-core/src/proof/`: find `focus` in `runs` (case and whitespace
  insensitive, across consecutive runs; not found → op error naming the closest run); build the card (browser frame
  with the real URL, image cropped around the focus region, rounded mask); tracks: slide in, ease to `zoom` centred
  on the focus rect, then a marker rect grows across it at the quote's start; out before the next proof or
  chapter. Works in the visual panel of `split-top` and full frame. Tests on a fixture `boxes.json`. Flip
  `proof.capture` and `proof.card`.
- [ ] **C6. Guide `proof`** in `guides.ts`: when a claim earns a proof, capture first, pick `focus` from text that is
  actually on the page, one proof per claim, ≤ 6 per clip.
- [ ] **C7. Look and measure.** Capture a real GitHub README, place a proof on a test clip, export, and look at the
  zoomed and marked frame at full size; Notes.

**Checks:** `npm run db:reset && npm run db:test`; engine `pytest` + `ruff`; `npm run check:contracts --workspace
@opencmo/web`; `npm run check:api --workspace @opencmo/web`; editor-core tests.

---

## Test prompts (the owner runs these on production at the end)

1. The acceptance test above.
2. The same clip with `/style senior-dev-listicle` on a clip that mentions no URL: no proof, no error, and the
   receipt says no proof was found.
3. "Emphasize 'free' and '24'" in the assistant on a styled clip: only those two words change.
4. `capture_page http://169.254.169.254/` and `capture_page http://localhost:3000`: both refused in plain English.
5. Undo once after `apply_style`: the clip is back to exactly how it was.

## Out of scope (next PRs)

- **"Make my clips look like this"**: upload a reference reel, the assistant reads its frames and writes a style
  skill plus the list of capabilities it would still need. Built on this PR's format.
- A style picker in the editor UI and a default style in the brand kit (so the 5-clip pipeline applies it without
  the assistant).
- Moving the CMO playbooks and the built-in guides into `packages/skills`.
- Saving a user's own style through `save_skill` with a `preset`.
- More styles ("founder story", "product demo", "podcast cut").

## Notes

### Track A

- **Branch.** `claude/video-editing-review-hrrmqx` had been deleted with PR #61 (docs only, already in `main`);
  recreated from `main`. B and C have not pushed yet, so every Track B/C capability is still `ready: false`.
- **A1.** `capabilities.ts`, `style/preset.ts`, `style/plan.ts`, `packages/skills/src/format.ts` as in the contracts.
  Nested plan items are `.strict()` too, so an unknown key fails at every level. `StylePresetSchema` takes
  `chapters.transition: whip` before B1 lands (`STYLE_TRANSITIONS` = `TRANSITION_TYPES` + `whip`); `apply_style`
  reports `transition.whip` as unavailable until B flips it.
- **A2.** `packages/skills` is a workspace package (`@opencmo/skills`). Folders per kind (`styles/`, later
  `playbooks/`, `guides/`); the kind must match the folder. YAML is parsed at build time only (`yaml`, ISC,
  dev dependency); the runtime reads `src/index.gen.ts`. `--check` runs in `check:contracts`; CI runs
  `check:skills` + `test:skills`.
- **A3.** The registry check lives in `capabilities.test.ts` (editor-core tests, so CI runs it) on top of
  `capabilityIssues()`. `npm run skills:gaps` today: `senior-dev-listicle` waits for `caption.emphasis`,
  `title.hook`, `speaker.punchIn`, `proof.card`, `transition.whip`.
- **A4.** `styles/senior-dev-listicle.md`: preset as in the contract; examples are our own, nothing from the reel.
- **A5.** `apply_style` is one registry op, so the batch is one revision and one undo. It runs the other ops
  through the registry by name (`styleOp(deps)`); a sub-op's `OpFailure` becomes a skipped item, a quote not in
  the transcript too. Rerun: the groups an earlier run placed (`marks.visual.op` of `add_hook_title`, `add_list`,
  `add_proof`) are removed first and named in `applied` ("Replaced 1 earlier hook title"); emphasis is written
  with `clear: true`, also when the new plan has none and the captions still carry some. Chapter transitions go on
  the left piece of the cut within 0.6 s of the chapter's first word; no cut there → skipped with that reason.
  The tests fake B's and C's ops at their contract. Measured: well under the 300 ms budget (the test asserts it).
- **A6.** `<styles>` (ready styles only) in the clip context; `read_skill` reads ready styles before user skills;
  `/style` appears in the menu, and `apply_style` in the tool list, only while a style is ready (the eval calls the op directly); `capture_page` / `capture_status`
  (`lib/agent/capture-tool.ts`) are offered only while `proof.capture` is ready and call `capture_create` /
  read `page_captures` under RLS; `serverOpContext` gives `apply_style` the capture reader. The tool result of
  `apply_style` carries its receipt (same run on the same snapshot first: `styleReceipt`).
- **A7.** The 7 CMO playbooks have `kind: playbook`; `build-cmo-skills.mts` requires it. `index.gen.ts` unchanged.
- **A8.** Eval `style-listicle` (fake provider) passes: one `apply_style`, quotes in the transcript, emphasis
  ≥ 2 s apart, hook ≤ 8 words a line, no proof without a checked capture, receipt in the reply. Full fake run:
  41/43; the two misses (`explain-make`, `explain-vaccine`) fail the same way on `main` in a container without
  explainer previews.
- **Not checked by looking yet:** nothing renders differently until B and C land; the acceptance run (frames at
  the hook and the proof) belongs after B9 / C7.

### Track B

### Track C

- **C1.** `20261128090000_page_captures.sql` + `158_page_captures.test.sql` (32 assertions). `page_captures`
  (owner-only `select` under RLS; no client writes), `tasks_kind_check` + `task-kinds.json` gain `capture_page`.
  `capture_create(p_url)` normalizes the address first (`normalize_capture_url`: lowercase scheme and host, no
  fragment, default port dropped) and refuses in plain English anything that is not a public http(s) name on its
  default port (`localhost`, IP literals in private ranges, `0x7f.1`-style tricks, IPv6 literals, credentials,
  single-label names). That is only the fast first layer; the capture itself checks every connection (C3). Cache:
  the same normalized URL, same user, pending or ready, < 24 h → the same id, not counted again. Cap: 30 captures
  per rolling 24 h (failed ones count too). The worker finishes with `complete_page_capture` (capture ready + task
  done in one transaction, paths fixed by the RPC to `<user>/<capture>/page.png|page.boxes.json`); a task that
  fails or is cancelled fails its capture with the task's sentence (trigger). Private `captures` bucket (PNG +
  JSON, 25 MB), owner reads their own folder; `storage_deletions` and `purge_unpaid_accounts` include it.
  Docker Hub/ECR/GHCR refused the Supabase image in this container, so the pgTAP run was on a local Postgres 16
  with a minimal Supabase shim over `schema/current.sql` (32/32); CI runs it on the real stack.
  `current.sql` was updated from the before/after dump diff of that database.
- **C3.** `opencmo/capture/`: `page.py` (Playwright, 1280 viewport, device scale 2, 15 s navigation, full-page PNG
  clipped to `max_height`, one run per word from `Range.getClientRects`, in document CSS pixels, hidden text
  skipped), `guard.py` (a forward proxy every connection of Chromium goes through: it resolves each host once,
  refuses unless every answer is public and the port is 80/443, then connects to the address it checked, so DNS
  rebinding and redirects cannot slip past; plain HTTP is one request per connection), `addresses.py` (the rules of
  `site.ts` plus `ipaddress` and IPv4 inside IPv6). Also: only http(s) URLs routed, service workers blocked, no
  downloads, no permissions, popups and dialogs closed, fresh context, WebRTC/QUIC off. Modal function
  `page_capture` on its own `capture_image` with **no secrets** (cpu 2, 2 GB, 90 s); the worker image sets
  `OPENCMO_CAPTURE=modal`. Measured here (`/usr/bin/time -v`, warm, 4 vCPU, this container's slow egress):
  `pypi.org/project/httpx` 6.8 s, 4471 px tall, 1.27 MB PNG, 786 words, 191 MB peak RSS; the
  `anthropics/claude-code` GitHub page 16–18 s, 7785 px tall, 2.0 MB, 817 words, 263 MB peak — of that, ~5.5 s is
  this container reaching GitHub and ~6 s is Chromium encoding the 2560×15570 PNG. Cold start of the Modal image
  is not measured (no Modal credentials here). Looked at both PNGs: PyPI renders fully styled; GitHub rendered
  unstyled here only because this container's DNS cannot resolve `github.githubassets.com` (the guard then
  refuses the tunnel, as it should); production DNS resolves it.
- **C4.** `opencmo/worker/capture_page_task.py`: checks the capture is this task's own pending row with the same
  URL, calls `page_capture`, validates `boxes`, moderates the whole page as ≤ 5 JPEG tiles of 1600 CSS px
  (streaming ffmpeg, `png_pipe` named) under a new `CAPTURE_POLICY` (safety rules only: a quoted page's logos and
  people are what it is), stores both files with upsert at the fixed paths, then `complete_page_capture`.
  Production without moderation keys refuses ("Page captures are not set up on this server yet."). Tests
  (`test_capture_page.py`, `test_worker_capture_page.py`, 52, real Chromium on a fixture server the test serves):
  `127.0.0.1`, `169.254.169.254`, `localhost:3000`, redirects to `169.254.169.254` / `10.0.0.1` /
  `https://127.0.0.1`, a redirect to another local port (which receives zero requests), and an `<img>`, `fetch`
  and `WebSocket` to local addresses on a page that still captures — all refused.
- **C2.** `POST /api/v1/captures` (`{ url }` → `{ capture_id, status }`), `GET /api/v1/captures/:id` (status, error,
  title, size, and signed `image_url` / `boxes_url` once ready) and `GET /api/v1/captures/:id/image` (303 to the
  signed PNG, `?resolve=1` → `{ url }`, for `capture:<id>` image sources, like `brand:` logos). All reads are under
  RLS; `lib/capture` holds the shared code (`createCapture` wakes the worker, `readCapture`, `captureUrls`,
  `readCaptureBoxes` with a zod schema of `page.boxes.json`). `captures` joined `BUCKETS` in `lib/storage.ts`.
  The daily cap uses the API's existing 429 sentence ("You have reached today's limit for this task. Try again
  tomorrow."). `check:api` has a new check (refusals, cache, owner-only reads, signed files once ready); it needs
  the full local stack, which could not start in this container, so it has not run yet. `check:contracts`:
  `video-usecases.check` and `agent-design.check` fail here exactly as they do without these changes.

## Requests

Cross-track asks. Format: `- [ ] (from X → owner Y) what and why`. The owner ticks it when done.

- [ ] (from A → owner B) `add_hook_title`: also take the preset's look — `accent_line`, `accent_box`,
  `font_family`, `accent_font_family`, `accent_font_style` — so `apply_style` can pass `preset.hookTitle`. Today it
  passes only `lines`, `start`, `end` (the contract).
- [ ] (from A → owner B) `emphasize_words`: accept `quotes: []` with `clear: true` (a rerun whose plan has no
  emphasis clears the old one), and keep a visual's `marks.visual.op` on the groups `add_hook_title` / `add_list`
  place: `apply_style` finds its earlier output by it.
- [ ] (from A → owner C) `page_captures` needs `status` and `error` columns readable under RLS
  (`lib/agent/captures.ts` selects them), and `capture_create(p_url)` returns the capture id; refusals in plain
  English (they reach the user verbatim). `add_proof`'s groups also need `marks.visual.op = 'add_proof'`.
- [ ] (from C → owner A) `capture-tool.ts`: call `createCapture(supabase, url)` from `@/lib/capture` instead of the
  RPC directly. It runs the same RPC and then wakes the worker; without the wake a capture waits for the next
  one-minute sweep, which breaks the < 20 s budget.
