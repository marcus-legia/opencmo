# Editor stability: fix-first pass

One branch (`editor-stability`), one draft PR, three Claude sessions working in parallel.
Goal: the editor stops losing edits, Ctrl+Z works across Assistant turns, dragging is smooth,
and the Assistant cannot run away. **Fix and harden what exists; no new features, ops or tools.**

Why these items: the architecture review found that the editor feels broken mostly because of the
state layer, not individual buttons. Evidence for each item is the file:line cited next to it.

## How the three sessions work together

1. **Branch.** Everyone works on `editor-stability`. Never force-push, never rebase published
   commits away. Before starting a task and before every push:
   `git pull --rebase origin editor-stability`.
2. **Ownership.** Each session edits only the files (or the line ranges) it owns in the table below.
   If you need a change in a file another session owns, add a line under [Requests](#requests) and
   carry on with something else. The owner picks it up.
3. **Small commits.** One task (or a meaningful part of one) per commit. Message format:
   `editor-stability A1: Queue session writes instead of dropping them`. English only.
4. **Tick your own boxes.** In the same commit as the work, tick the task's box in **your own
   section** of this file and add one line under "Notes" if something is worth knowing (a measured
   number, a decision, a follow-up). Do not edit other sessions' sections.
5. **Green before push.** `npm run typecheck` plus your track's checks (listed per track). A push that
   turns CI red blocks the other two sessions; fix it first.
6. **Verify by looking** (CLAUDE.md). For UI changes, run `npm run dev` and exercise the change in the
   browser. Say in Notes what you exercised.
7. **Project rules still apply**: English everywhere (including error strings that reach the user),
   comments explain why, translate Vietnamese comments in lines you touch, don't widen scope.

### File ownership

| Session | Owns |
|---|---|
| **A: State & undo** | `apps/web/lib/editor/session.ts`, `apps/web/lib/editor/session.check.ts`, `apps/web/components/editor/EditorShell.tsx` **only the `run()` callback (≈ lines 393–421)**, `apps/web/components/editor/library/useLibrary.ts`, `apps/web/components/editor/menus/dialogs.tsx`, `apps/web/components/editor/generate/useVoiceovers.ts`, `apps/web/components/editor/assistant/client.ts` |
| **B: Timeline & preview** | `apps/web/components/editor/timeline/Timeline.tsx`, `apps/web/components/editor/EditorShell.tsx` **only the media/renderer block (≈ lines 189–300) and the inspector-preview block (≈ lines 505–545)**, `apps/web/components/editor/playback.ts`, `apps/web/components/editor/media.ts` |
| **C: Agent & document integrity** | `apps/web/lib/agent/**`, `apps/web/app/api/v1/agent/**`, `packages/clip-doc/**`, `packages/editor-core/**`, and in `packages/clip-render/**`, `packages/clip-export/**` only the FPS import swap (C5) |

`EditorShell.tsx` is shared by line range. Keep your edits inside your range so git merges the two
sessions' commits without conflicts. If a range moves because the other session's edit landed,
re-locate it by the code, not the line number.

---

## Track A: State & undo

Fixes review issues #1 (undo wiped by every Assistant edit) and #2 (edits silently dropped / lost
updates). This track has the biggest user impact. Do it in order.

- [x] **A1. Serialized write queue in `DocumentSession`.**
  Add `transact(build, options)` to `apps/web/lib/editor/session.ts`:
  - `build(latest: ClipDocument)` returns either ops (applied with `applyOps` + `validate`) or a
    finished document. It always receives the document **as it is when the write runs**, never a
    copy read before an `await`.
  - Writes run one after another (promise chain). Nothing is dropped. A failing write rejects its own
    promise and does not stop the queue.
  - Options: `history?: boolean` (default true), `label?: string`, `origin?: "user" | "assistant" | "system"`,
    `manifest?` (same meaning as `commit`).
  - A write that leaves the document unchanged adds no undo step (`commit` already checks this).
  - Keep `applyOps` out of `session.ts` if that pulls editor-core into the session's tests in a bad
    way. In that case `transact` takes `build: (latest) => Promise<ClipDocument>` and the caller does
    `applyOps`. Pick whichever keeps `session.check.ts` runnable with a fake transport.
  - Tests in `session.check.ts`: two `transact` calls fired in the same tick both land, in order, and
    the second sees the first's result; a throwing write doesn't block the next; a no-op write adds no
    undo step.
- [x] **A2. Assistant edits become one undo step instead of wiping history.**
  `rebase()` (`session.ts:197-211`) currently clears both stacks (`session.ts:205-206`), so Ctrl+Z
  can't go back past any Assistant edit. Change it to push the tab's pre-rebase snapshot onto the undo
  stack (one step per adopted version), and clear only the redo stack. Undoing then commits the old
  document on top of the new server version through the normal save path. The manifest still never
  goes back with Undo (existing rule, `session.ts:38-43`). `adopt()` (conflict / external reset) keeps
  clearing history; that is correct there.
  Tests: rebase → undo restores the pre-rebase document and schedules a save with the new version;
  redo re-applies the Assistant's version; manifest unchanged by undo.
- [x] **A3. `run()` uses the queue.**
  In `EditorShell.tsx` `run()` (≈ 393–421) remove `if (busy) return null;` and route through
  `session.transact`. Keep `busy` only as UI state (spinner / disabled buttons), never as a guard
  that throws edits away. Keep the existing notice for `DocumentInvalidError` and op errors.
- [x] **A4. Every other document writer goes through the queue.**
  These read the document before an `await` and commit after it, without `validate()`:
  `library/useLibrary.ts:99-100`, `:192-193`, `:243-244`; `menus/dialogs.tsx:109`.
  Route each through `transact` so they apply to the latest document and are validated.
  (The id stamp at `EditorShell.tsx:129` is outside A's range; leave it, it is `history: false` and synchronous.)
- [x] **A5. Voiceover sync stops retrying forever.**
  `generate/useVoiceovers.ts:75-79` retries every `RETRY_MS` with no limit when `run` returns null.
  After A3 `run` no longer returns null for "busy", so: cap retries (e.g. 5), and log once when giving up.
  Voiceover attachment is bookkeeping, not a user action: commit it with `history: false` if that is
  safe for undo semantics (check that undoing the user's previous edit doesn't detach the voiceover).

**Checks:** `cd apps/web && npx tsx lib/editor/session.check.ts`, `npm run typecheck`,
`npm run check:contracts --workspace @opencmo/web`.

**Manual (npm run dev):** type quickly into several Inspector fields; every value sticks after reload.
Ask the Assistant for an edit, then Ctrl+Z: the edit is undone and saved; Ctrl+Shift+Z redoes it.
Import a file while a voiceover is attaching: both survive.

**Notes (A):**

- A1: `transact(build, options)` keeps editor-core out of `session.ts`; callers run `applyOps` inside `build`, the session validates. Undo/redo/rebase stay synchronous; a write whose document changed while `build` awaited is rebuilt on the new one (max 3 tries).
- A2: `rebase` pushes the tab's document as one undo step only when the Assistant's version differs; the panel's turn Undo goes through `rebase` too, so it is also one Ctrl+Z step.
- A3: `busy` is a counter of queued `run`s (spinner only). Dropped the now-unused `validate` import at the top of `EditorShell.tsx` (one line outside A's range).
- A4: library edits, generated-media removal, insert and version restore are `transact` writes reading the latest document and library. A `Built` result may carry `history`, since only `build` knows whether a library change touched the document (a rename does).
- A5: voiceover sync gives up after 5 attempts with one `console.warn`, and commits with `history: false`: undoing past it drops the `synced` mark and the hook attaches again (test in `session.check.ts`).

---

## Track B: Timeline & preview

Fixes review issues #3 (laggy drag) and the short-term part of #4 (preview vs export).

- [x] **B1. Coalesce drag previews and drop stale ones.**
  Every pointermove calls `preview(op)` (`Timeline.tsx:301`), which runs a full `applyOps`
  (`Timeline.tsx:195-205`). Change to: store the latest op on the gesture and run at most one preview
  per animation frame (`requestAnimationFrame`, latest op wins). Give each preview a sequence number
  and ignore results that come back after a newer one started or after `onUp` (`Timeline.tsx:307-331`),
  the same way the Inspector already does (`EditorShell.tsx:517-519`).
- [x] **B2. Compute snap targets once per gesture.**
  `targets()` (`Timeline.tsx:207-240`) calls `timesOf(props.base())` and walks the scene on every move.
  The committed document does not change during a drag: compute `committed`, `lookup` and the target
  list at gesture start and keep them on the gesture.
- [x] **B3. Only the main renderer follows the drag preview.**
  `doc = preview ?? state.document` (`EditorShell.tsx:174`) drives `media.preload` (`:198-207`),
  the sample renderer (`:238-247`) and the other-scene renderers (`:264-290`), so each preview step
  rebuilds all of them. Key `media.preload`, `sampleRenderer` and `otherScenes` on `state.document`;
  keep the main `renderer` on `doc`. Measure before/after (Performance panel, a drag across a clip
  with 50+ elements) and write the numbers in Notes.
- [ ] **B4. Playback accuracy, short-term.**
  `playback.ts:19` re-seeks only when a `<video>` drifts more than `DRIFT = 0.2` s (≈ 6 frames).
  - Use `requestVideoFrameCallback` where available to read the presented `mediaTime` instead of
    trusting `currentTime`.
  - When paused or scrubbing, seek exactly to the frame.
  - Lower the drift threshold during playback only if it does not make playback stutter; measure.
  - Two pieces of the same source visible at the same time share one `<video>` (`media.ts:7-11`), so
    a transition between two cuts of the master shows the wrong frame. Give the second piece its own
    element in that case only.
  Respect the hard rule: user media is read through the existing allowlisted paths; don't add new
  ways to load media.

**Checks:** `npm run typecheck`, `npm run check:clip-render`; e2e that touch the timeline
(`apps/web/e2e/editor-rows.spec.ts`, `editor-clipping.spec.ts`) via `cd apps/web && npm run test:e2e`.

**Manual (npm run dev):** drag and trim on a timeline with 50+ elements: smooth, and the clip lands
exactly where the preview showed. Release outside the timeline: no leftover ghost preview. Play
across a cut between two pieces of the master and pause on both sides: correct frames.

**Notes (B):**

- B1/B2: previews run once per animation frame via the gesture's latest op; `onUp` bumps the Timeline's own sequence so a late preview can't bring the ghost back (no change needed in EditorShell's JSX). Snap targets live on the `move`/`trim` gesture. `editor-rows.spec.ts` passes; `editor-clipping.spec.ts` couldn't run yet because another session's e2e run was recreating the shared `opencmo-e2e` stack at the same time.
- B3: `media.preload`, `sampleRenderer` and `otherScenes` follow `state.document`; only the main renderer follows the preview. Adjust-tab scopes now update on release, not mid-drag. Node bench (60 elements + 2 other scenes, renderer builds only): 0.33 ms → 0.13 ms per preview step. Browser Performance-panel numbers: pending, measured with B4's browser pass.

---

## Track C: Agent & document integrity

Fixes review issues #7 (projects grow until they can't be saved), #9 (unbounded Assistant loop),
#10 (scattered FPS constants), and the server half of #1 (Assistant Undo discarding later manual edits).

- [x] **C1. Bound the Assistant loop.**
  `apps/web/lib/agent/loop.ts:183` is `for (let step = 0; ; step++)`, bounded only by credits and
  request time. Add `MAX_STEPS` to `lib/agent/limits.ts` (e.g. 40 per request) and pause with
  `awaiting_continue` and a new reason `"steps"`, the same way `"time"` works (`loop.ts:211`). Also stop
  when the same tool call (same name + same input) fails 3 times in a row, telling the model why.
  Make sure the tab handles the new reason (if that needs a change in `components/editor/assistant/**`,
  that's A's `client.ts` or the panel: add a Request).
- [x] **C2. Assistant Undo never silently drops manual edits.**
  `app/api/v1/agent/sessions/[id]/turns/[number]/undo/route.ts:17-33` restores the turn's checkpoint
  even if the user edited the clip after the turn. If the clip's current version is not the version
  the turn last wrote, refuse with a clear English message ("You edited this clip after the Assistant's
  change. Use Undo in the editor (Ctrl+Z) to step back through both.") instead of restoring. After A2
  ships, Ctrl+Z is the path that keeps both.
- [x] **C3. Timing invariants.**
  `validate()` only checks shape. Add `timingIssues(doc)` in `packages/clip-doc` (start < end,
  sourceIn < sourceOut, no negative times, playbackRate > 0). In `applyOps`
  (`packages/editor-core/src/ops/index.ts:249-291`), reject a batch that **introduces** an issue on an
  element it touched, with an actionable `OpError` message. Existing documents with old issues must
  keep loading and saving. Tests in editor-core for each invariant and for "old issue doesn't block".
- [x] **C4. Face-track data stops multiplying with each cut.**
  `segment()` (`packages/editor-core/src/captions.ts:169`) copies the whole face track into every cut
  segment; long clips cut by `remove_silence` can hit the 256 KB cap (`clip-doc/src/validate.ts`).
  Follow the existing design in `docs/ke-hoach-pr-sau.md` §2 exactly, **starting with its step 1
  (measure)**. If the measurement says it isn't needed, stop and write the numbers in Notes.
- [x] **C5. One FPS constant.**
  About 20 copies of `FPS = 30` live across packages (e.g. `editor-core/src/ops/timeline.ts:30`,
  `clip-render/src/draw.ts:410`, `clip-export/src/export.ts:106`). Export one constant from the
  clip-doc time module and import it everywhere **inside `packages/`**. No behavior change: golden and
  parity tests must stay identical. Leave copies in `apps/web` for whoever owns those files.
- [x] **C6. Run the eval against the real model.**
  CI only runs `lib/agent/eval` with the fake provider. Add an npm script that runs
  `lib/agent/eval/run.ts` with the real provider (document the expected cost in the script comment),
  run it once, and write the pass rate and the failing task names in Notes. Do **not** add it to CI.
  Do not "fix" failures by changing the fake model.

**Checks:** `npm run check:clip-doc && npm run check:editor-core && npm run check:clip-render && npm run check:clip-export`,
`npm run check:contracts --workspace @opencmo/web`, `npm run typecheck`.

**Notes (C):**

- C1: `MAX_STEPS = 40` per request pauses with 'steps', which auto-continues like 'time' (owner's call), so the real stop for a looping model is the repeated-failure rule: the 3rd identical failing call (same name + canonical input) is told to change course, the 4th ends the turn. 'steps' needs migration `20261123090000_agent_step_pause.sql` (+ pgTAP `153`); `supabase db test` passes. The panel side is a Request to A.
- C2: each write's resulting clip version is now stored in its `agent_tool_calls.result` (`version`; per clip in `apply_to_clips`). Undo refuses with the 409 message when the clip moved past it; after an undone newer turn it checks that turn followed directly (versions bump by exactly 1 per save) and that the clip still holds that turn's checkpoint. Turns from before this change restore as before. Rule + tests in `lib/agent/undo-guard.ts` / `.check.ts` (in `check:contracts`). Known false refusal: any non-user save after the turn (e.g. the tab's id stamp) also counts as an edit; that refuses safely and never loses work.
- C3: `timingIssues(doc)` in `clip-doc/src/timing.ts`; `applyOps` judges the whole batch (one op may set `start`, the next `end`) and rejects only issues the input didn't have, keyed by node id (or kind + timing values for id-less nodes, so the id stamp doesn't make old issues look new). None of the 70 parity samples has an issue; all 567 existing editor-core tests unchanged, plus 9 new in `timing.test.ts`.
- C4: the design in `ke-hoach-pr-sau.md` §2 had already landed in 725f258 (`faceXTrack` in `segment()`, tests in `face-track.test.ts`), so I only measured (step 1). Setup: the `longClip` fixture with a realistic engine track (≤ 40 keys, `MAX_KEYFRAMES` in `steps/reframe.py`), then `remove_silence` 3× (only the first pass cuts). 10 min: 3.5 KB → 52.5 KB, 119 segments = **20% of the 256 KB cap**, under the doc's 30% stop line, so no further work. 54 min: 286 KB, 647 segments = **109%: cannot save**. Face data is now about 214 B per segment (≈2 keys) and doesn't multiply any more; the same cut with no face track is still 148 KB (56%, ≈174 B per bare segment). So what still breaks long clips is the segment count, not face-track copies. Follow-up (out of scope here): derive segment `x` from the mark at render time, or store cuts more compactly.
- C5: reused the existing `FRAME_RATE` from `clip-doc/src/time.ts` rather than adding a second constant. It replaces the 10 local `FPS = 30` copies (`clip-render/tree.ts` still exports `FPS = FRAME_RATE`) and the bare grid literals in `draw.ts`, `frame.ts`, `export.ts`, `segment.ts`, `layout.ts` and `ops/project.ts`. Left alone: `FPS_CHOICES`, the schema's fps union, `probe.ts` (source fps) and `clip-three` (no clip-doc dependency; `spec.ts` keeps its own `FPS`). Node parity renders are **byte-identical** before and after (sha256 of all 155 candidate frames). In this container node parity fails the same 31 text frames with or without the change (fonts here differ from CI's), so CI's parity job is the real gate. Browser parity was not run here (it needs Chromium 141).
- C6: **skipped** (owner's call). This container has no `ANTHROPIC_API_KEY` and a real run costs API money. `npm run agent:eval -- --provider anthropic --yes` already exists for whoever has a key (it prints a cost estimate without `--yes`).

---

## Requests

Cross-track asks. Format: `- [ ] (from X → owner Y) what and why`. The owner ticks it when done.

- [ ] (from C → owner A) C1 adds pause reason `"steps"` (request hit `MAX_STEPS`). It must auto-continue exactly like `"time"`: add it to the reason type in `assistant/client.ts` (≈ line 62) and treat `reason`/`pause_reason === "steps"` like `"time"` in `assistant/AssistantPanel.tsx` (≈ lines 242, 410, 710). The `continue` route already accepts it. Until then a 'steps' pause shows no Continue button and the turn waits.

---

## Out of scope for this PR (follow-ups)

Listed so nobody starts them here:
UI state out of the document (`selected`, `clipHeight`, `expanded`, `playhead`; needs a schema migration),
explicit tracks in the schema, integer-frame time in the schema, patch-based history, WebCodecs preview,
tool consolidation, compact `get_timeline` with mutation-delta receipts and short ids.

## Done when

- Every box above is ticked (or explicitly skipped with a reason in Notes).
- CI is green on the PR head.
- The user has run the three manual checklists above.
- Then the PR is marked ready for review.
