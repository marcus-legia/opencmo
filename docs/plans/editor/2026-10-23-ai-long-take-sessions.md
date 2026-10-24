# AI long take: work split for three sessions, one PR

Plan: [`2026-10-23-ai-long-take-plan.md`](2026-10-23-ai-long-take-plan.md). Read all of it first: the feature list
(§2) and the todo list (§5) are the source of truth; this file only says who does what, in which order.
Branch: **`plan/editor/2026-10-23-ai-long-take`** · PR: [#111](https://github.com/marcus-legia/opencmo/pull/111)
(draft), shared by all three sessions.

| Session | Name | Tasks | Features |
|---|---|---|---|
| **A** | Models, worker, SQL | 0, 1, 6, then 8 + Release (lead) | F9, F10 (catalog), F13 |
| **B** | Director, stage 1, MCP | B0 contracts, 2, 3, 7 | F1, F2, F3, F4, F10 (pick), F12 |
| **C** | Editor, stage 2, redo | 4, 5 | F5, F6, F7, F8, F11 |

## Rules for all sessions

1. **Own your paths** (below). A file under "Shared" may be edited by anyone, but only in the named block:
   `git pull --rebase` right before editing it and push right after.
2. **Same branch, no force.** Run `git pull --rebase origin plan/editor/2026-10-23-ai-long-take` before every push.
   Never `--force`, never rebase pushed commits, never push to `main`, never merge the PR.
3. **Small commits, prefixed** `[A]`, `[B]` or `[C]`, in English, each green on its own (typecheck plus the tests of
   the packages it touches).
4. **Tick your checklist** below, and the matching boxes in the plan's §5, in the same commit that finishes an item
   (only your own section).
5. **Repo rules apply** (`CLAUDE.md`):
   - moderation on every keyframe and shot; no model names in user copy;
   - English everywhere, including comments you touch; comments explain why;
   - learn from competitors, never copy their code or prompts.
6. **Migrations belong to Session A only.** Timestamps go in order of commit. Whoever commits a migration regenerates
   `supabase/schema/current.sql`. If B or C needs SQL, write a "Requests" note (below) and A adds it.
7. **Heavy suites one at a time** on one machine (`npm run build`, `db:reset`/`db:test`, e2e, real provider calls).
8. **Do not deploy.** The plan's Release section is the owner's, in that order.
9. **Real provider calls cost money.** Only Session A makes them (Task 0, Task 1 and Task 8), and logs the credits
   spent in the PR.

## Shared contracts (Session B lands these first, in B0)

New file `packages/editor-core/src/long-take.ts`, exported from `packages/editor-core/src/index.ts`. B and C code
against it from their first commit; change it only after a "Requests" note all sessions agree on.

```ts
// One beat of a long take: the words it covers, its first frame, and how it moves.
LongTakeShotSchema = z.object({
  seconds: z.number().min(1).max(15),
  words: z.string().min(1).max(600),          // the exact slice of the script
  keyframe: z.string().min(3).max(300),       // first frame: subject, place, light, framing; no text
  motion: z.string().min(3).max(300),         // camera, subject action, surroundings
  continues: z.boolean(),                     // true: joins the next keyframe; false: hard cut after it
  text: z.string().max(60).optional(),        // on-screen words, an editor text layer
});
LongTakePlanSchema = z.object({ title, script, style, music, shots: z.array(LongTakeShotSchema).min(1).max(18) });

// Which keyframe a shot starts and ends on; index into `keyframes`.
keyframeIndexes(plan): { start: number; end: number | null }[]   // pure, unit-tested
KEYFRAMES_MAX = 19

// Tool results the Assistant and MCP pass between stages.
CreateVideoResult  = { plan: LongTakePlan; aspect; seconds; keyframes: { generation_id: string; index: number }[] }
AnimateVideoInput  = { plan: LongTakePlan; aspect; keyframes: { generation_id: string; index: number }[]; voice?: string }
RedoKeyframeInput  = { scene_id: string; index: number; keyframe?: string }
```

Catalog contract (Session A, Task 1): video rows that can join two frames have `limits.firstFrame: true`,
`limits.lastFrame: true` and `limits.providerInputs: { start: string; end: string }`. Until A pushes them, B and C
use `fake-video`, which already has both frames.

Keyframe quality (Session A, Task 6): generations get `quality: { text: "none" | "minor" | "severe" } | null`,
readable under RLS. C shows the badge only when the field is present, so C does not wait for A.

## Session A: models, worker, SQL

**Owns:**
- `packages/contracts/ai-models.json`
- `packages/engine/opencmo/ai/providers/fal.py`, `packages/engine/opencmo/ai/moderation.py` and their tests
- `packages/engine/opencmo/worker/generate_task.py` (the quality call only)
- `supabase/migrations/*_long_take_*`, `supabase/tests/*_long_take_*`, `supabase/schema/current.sql`
- `apps/web/lib/pricing.check.ts` expectations
- `docs/plans/editor/2026-10-23-ai-long-take-frames/`

**Order:** Task 0 → Task 1 (push the catalog rows as soon as pgTAP passes) → Task 6 → wait for B and C → Task 8 →
Release checklist ready for the owner.

- [ ] Task 0: baseline (30 s and 60 s `/video` with today's code; frames, credits and time in `before/`)
- [ ] Task 1: Veo 3.1 first-last-frame and Kling 3.0 Pro rows, `providerInputs`, `fal.py` mapping, prices,
      migration + pgTAP, schema dump
      (2026-10-23: code pushed as `fal-veo` / `fal-kling-v3`. Still open: one real call each, which needs `FAL_KEY`;
      fal.ai is unreachable from the cloud session. Durations, input names and `typicalSeconds` are PROVISIONAL.
      See "Task 1 status" below.)
- [x] Task 6: garbled-text check on keyframes, `quality` column (migration + pgTAP), worker test
      (2026-10-23: every finished AI image is checked, not only keyframes, because the worker cannot tell a keyframe
      without a new spec field, and one vision call costs far less than the 1-credit image. See "Task 6 status".)
- [ ] Task 8: acceptance video, `after/` frames, numbers in the PR
- [ ] Release checklist written in the PR for the owner (`db push --dry-run` output, worker before web)

### Task 1 status (Session A, 2026-10-23)

Rows B and C can code against now:

| id | Name (user copy) | Aspects | Durations (s) | Credits/s | Frames |
|---|---|---|---|---|---|
| `fal-veo` | Cinematic | 9:16, 16:9 | 4, 6, 8 | 4 (720p and 1080p) | start + end |
| `fal-kling-v3` | Cinematic square | 16:9, 9:16, 1:1 | 3–15 | 3 | start + end |

- Both are `silent`: the worker always sends `generate_audio: false`, so a spec never carries `audio`.
- `fal-veo` sends a start-only (cut) shot to Veo's image-to-video endpoint and a start + end shot to its
  first-last-frame endpoint (`providerModels.frames`). Kling takes both on one endpoint.
- To confirm with the first real call (owner or a session with `FAL_KEY` and access to fal.ai):
  1. Veo first-last-frame accepts 4 s and 6 s, not only 8 s (Gemini's own Veo API needs 8 s for a last frame).
  2. Kling 3.0 Pro durations are 3–15 and its image endpoint ignores `aspect_ratio` (the frame follows the
     start image).
  3. `typicalSeconds` (120 / 180 for now).
  4. The input names: Veo `first_frame_url` / `last_frame_url`, Kling `start_image_url` / `end_image_url`.
- If one is wrong: fix the JSON row and this migration together, while PR #111 is open. Never edit them after merge.

### Task 6 status (Session A, 2026-10-23), for C's badge

- `GET /api/v1/generations/:id` (and the list) now return `quality: { text: "none" | "minor" | "severe" } | null`
  (`apps/web/lib/generate/models.ts`). `null` means not checked: videos, fake mode, or no checker answered.
- Badge only on `severe`. It never fails a generation and never refunds.
- Local test data: a fake image whose prompt contains `[[garbled-text]]` comes back `severe`.
- Migration `20261226100000_long_take_quality.sql`: `generations.quality`, and `complete_generation(…, p_quality)`.
  The worker sends `p_quality` only when it has one, so it still completes generations on a database without this
  migration. Release: `db push` before the worker, as planned.
- MCP `get_generation` does not show `quality` yet (Task 7 can add it if MCP needs it).
- PR #108 edits the same worker files (`generate_task.py`, `moderation.py`, `backends/supabase/generations.py`)
  but not `complete_generation`. Whichever PR merges second needs a small merge there.

## Session B: director, stage 1, MCP

**Owns:**
- `packages/editor-core/src/long-take.ts` and its test
- `apps/web/lib/agent/create-video.ts` (director, review, model pick, `create_video` tool)
- `apps/web/lib/generate/brief.ts` (prompt rules)
- `apps/web/lib/agent/screen-pieces.ts` (keyframe names)
- `apps/web/lib/agent/guides.ts` (the `video` guide)
- `apps/web/lib/agent/eval/tasks.ts` (only `/video` tasks)
- `packages/mcp-server/src/groups/{studio.ts,guides.ts}`

**Order:** B0 (push at once) → Task 2 → Task 3 → Task 7 (after C pushes its tools).

- [x] B0: shared contracts in `long-take.ts` with unit tests for `keyframeIndexes` (all continuous, all cuts, mixed)
- [x] Task 2: director v2, review rules, prompt rules, model pick with honest fallback, fake plan, eval passes
- [x] Task 3: `create_video` prices and creates keyframes only; card 1 lines; library folder; `CreateVideoResult`
- [ ] Task 7: MCP plan format, `animate_video` and `redo_keyframe` in the studio group, guides, `mcp-server` checks

## Session C: editor, stage 2, redo

**Owns:**
- new `apps/web/lib/agent/long-take.ts` (`animate_video` and `redo_keyframe` tools)
- `packages/editor-core/src/ops/create-video.ts` and its test (shots with `startImage` / `endImage`, one `sequence`)
- the contact-sheet card under `apps/web/components/editor/assistant/`
- the "Redo keyframe…" item in the editor's shot context menu (`apps/web/components/editor/menus/`)

**Order:** Task 4 (with `fake-video`, starting right after B0) → Task 5.

- [ ] Task 4: `animate_video` (refuses missing keyframes, builds start/end specs, voice and music), contact sheet
      with Redo per tile and the exact price, the op places one `sequence`, no double payment
      (all in; open only for the local-stack run of the no-double-payment check, see the plan's Task 4)
- [x] Task 5: `redo_keyframe` (new keyframe plus at most 2 shots, old files kept, undo), context menu, tests

## Shared files

| File | Who edits what |
|---|---|
| `apps/web/lib/agent/tools.ts` | B registers `create_video` changes; C registers `animate_video` and `redo_keyframe`. One line each, in the tool list |
| `packages/editor-core/src/index.ts` | B adds the `long-take.ts` export; C adds op exports |
| `apps/web/lib/agent/slash.ts` | B only: the `/video` hint text |
| `docs/plans/editor/2026-10-23-ai-long-take-plan.md` | Each session ticks its own §5 boxes |

## Hand-offs

| When | From → to | What |
|---|---|---|
| B0 pushed | B → C | Contracts exist; C starts Task 4 |
| Task 1 pushed | A → B, C | Real `lastFrame` rows; B's model pick and C's specs switch from `fake-video` |
| Task 4 pushed | C → B | `animate_video` exists; B wires it into MCP (Task 7) |
| Task 6 pushed | A → C | `quality` field exists; C's badge shows on real data |
| B, C done | B, C → A | A runs Task 8 on the finished flow |

## Reviewer

A fourth session reviews every pushed commit and fixes bugs it finds, in `[R]` commits. It pulls before each fix,
keeps fixes minimal and inside the commit's own files, and notes each one under Requests so the owning session sees
it. A larger problem becomes a Requests line for the owner instead of a fix.

## Requests

Write a dated line here when you need something from another session (a contract change, a migration). Who owns the
change answers on the line, and the change goes in a separate `[X]` commit.

- 2026-10-23 [R] → B, C: `CreateVideoResultSchema` and `AnimateVideoInputSchema` now check that `keyframes` is exactly
  0..`keyframeCount(plan)`-1, each once (a gap left a shot with no first frame). They carry a `superRefine`, so build
  tool schemas from them directly; zod 4 refuses `.extend()` on a refined object (wrap with `z.object({...})` instead).
- 2026-10-23 [R] → B: `SHOT_STYLES` repeats `STYLES` in `apps/web/lib/generate/brief.ts` (same five values today).
  In Task 2, have `brief.ts` import `SHOT_STYLES` so the two cannot drift.
  **B, done in Tasks 2-3:** `STYLES = SHOT_STYLES` in `brief.ts`. The tool schemas never `.extend()` the refined
  schemas (`create_video` reads `plan` as `LongTakePlanSchema`).
- 2026-10-23 [R] → A: Task 1's migration was `20261224090000`, the same version as `20261224090000_abuse_limits.sql`
  in PR #108 (security + credit fixes, not merged yet). Two files with one version break `supabase db push`. Renamed
  to `20261226090000_long_take_models.sql` (after #108's last, `20261225090000`), and the test to
  `199_long_take_models.test.sql` (#108 has 197 and 198). For later migrations here: start after `20261226090000`
  and test numbers after 199. pgTAP 145 (3/3) and 199 (14/14) pass on a fresh database.
- 2026-10-23 B → C (hand-off, Tasks 2-3 pushed): for `animate_video`, reuse from `apps/web/lib/agent/create-video.ts`
  `pickShotModel(aspect, wanted?)` (→ `{ model, joins }`), `shotPrompts(plan, model, aspect, joins)` (prompt and
  duration per shot, same as card 1 priced), `timeShots`, `keyframeDescriptions` and `SEPARATE_SHOTS`, so card 2's
  price matches card 1's estimate. Stage 1's tool result is `{ result: CreateVideoResult, voice? }`; with no lastFrame
  model every `continues` is already `false`. Keyframes sit in the library as image records whose
  `generation.key` is `imageKey(model, spec)` (`lib/agent/keyframe-library.ts`); the editor finishes them
  (`useGenerations` now resumes server-started pending records), so a shot can name a keyframe by its library path
  or, server-side, by generation id through `resolveMediaRefs`. B finishes Task 7 (MCP checks for the two new tools)
  once `animate_video` and `redo_keyframe` are in `clipToolSpecs()`.
- 2026-10-23 [C] → B (Task 7, answers the line above): `animate_video` and `redo_keyframe` are in `clipToolSpecs()` (`lib/agent/long-take.ts`,
  wired in `scope.ts`); their inputs are `AnimateVideoInputSchema` and `RedoKeyframeInputSchema` as they stand, and
  over MCP they go through `scope.plan` / `scope.decide` like `create_video`. The contact sheet's Redo is a decision
  `{ approved: false, redo: { index } }` (Assistant only); over MCP a keyframe is redone before stage 2 by asking
  again, which is yours to describe in the guide.
- 2026-10-23 [C] → B: stage 2 calls your `pickShotModel`, `timeShots` and `shotPrompts`, so both cards price the same
  shots; keep them exported. `libraryName` is now exported too (the redone keyframe goes in the scene's
  `Generated/<title>/keyframes/` folder through `saveKeyframes`). `screenPieces` takes the tool to name in its
  message (`create_video` by default). `redo_keyframe` swaps the first sentence of a keyframe prompt for the new
  description, so `composeKeyframePrompt` must keep opening with the beat's `keyframe` sentence.
- 2026-10-23 [C] → B, A: a placed shot names each keyframe by the image's own declaration (`{ generate: "image",
  prompt, model, aspectRatio, resolution?, seed }` = the generation's stored spec), not a library path, and the
  scene is the `sequence` named after the video (`keyframesOf` in editor-core reads its keyframes back). Voice and
  music stay outside it (see the plan's Task 4).
- 2026-10-23 [R] → A, B, C: fixes from the owner's two code reviews of the branch, in `[R]` commits:
  - op (`create_video`): placing the same take again pulled the first scene's shots and music into the new one;
    only entities the op adds are gathered now. `redo_keyframe` op takes a 100-char id like its tool.
  - stage 2 now gets `model` from stage 1 (`CreateVideoResult.model`, `AnimateVideoInput.model`; pass it back as
    returned). A short continuous last shot is allowed (no shot starts on the closing keyframe). `review()` takes
    `joins` and skips the exact-length rule when no model joins frames. `redescribe()` no longer cuts at "a.m.".
  - Redo on the contact sheet now lists the new keyframe in the library (`ListKeyframe`); `redo_keyframe` checks the
    in-flight cap before paying, needs the library record before paying for shots, and says when the keyframe's
    credits were spent. The editor no longer re-POSTs a server-started keyframe that failed (it charged a new one).
  - Shared: `pickMusicModel`, `credits`, `minutes` (create-video.ts); one keyframe store in `scope.ts`.
  - Not changed, for the owner: `text_quality` runs on every AI image, not only keyframes (one extra vision call each;
    scoping it needs a spec field the SQL checks). Small leftovers: `findShot` in long-take.ts could use `byId`,
    `ContactSheet` types are written twice (client.ts and long-take.ts).

- 2026-10-24 [R] → A, B, C: #109 took #104 back out of `main`, so this branch (cut while #104 was on `main`) conflicted
  with it. PR #108's branch (#104 + #107 + credit fixes, one release) is now merged in (`49734aa`): the worker runs
  `check_prompt` and `mark_generation_sent` from #108 next to `text_quality`, and `current.sql` is a fresh dump of all
  migrations in order (#108's 20261224/20261225, then ours 20261226…). Pull before your next commit. Merge order:
  #108 into `main` first, then this PR; until then this PR's diff also shows #108's changes.
