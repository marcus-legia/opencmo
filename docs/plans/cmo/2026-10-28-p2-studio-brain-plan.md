# P2: Studio joins the brain, and every finished video becomes shorts

> **For agentic workers:** §2 says *what* ships, §5 the tasks. Three sessions build it on branch **`cmo-p2`** (PR into
> `cmo-build`). Each session's numbered todo list, owned paths and order are in
> [`2026-10-28-p2-sessions/`](2026-10-28-p2-sessions/): read `README.md` there, then your own file. Build nothing
> before your Task 0 is done; nobody builds on a contract before it is pushed.

## 0. Scope

Phase 2 of [`2026-10-28-backend-roadmap.md`](2026-10-28-backend-roadmap.md). It builds four backend phases: **B3**
(capability registry, event rules, Studio adapter), **S1** (finished state; a short renders as its own edit), **A1** (Studio
cards in the queue), **S2** (Shorts squad). After it: 8 of 28 backend phases (≈ 29%). The UI for these screens
already exists on fixtures (wave 1); this phase makes it live.

Not in this phase: captions and hashtags for shorts (Writer W3, P3), posting shorts (P4), slideshows and post images
(S3, P5), the look check (S4, P6).

## 1. Goal and decisions

**Goal:** the week plan can contain a video. The brain hands a video brief to Studio's Video agent team, whose cards
(storyboard + keyframe price, contact sheet + video price, finished video) land in the Dashboard queue. Approving the
finished video marks the edit finished, and a finished edit (AI or the founder's own) is cut into a batch of 3 shorts
the founder approves at once. The brain never drives single tools inside the team (`brain.md` §7b).

**Decisions already made (owner, 2026-10-25 → 10-27):**
- One Studio adapter: `apps/web/lib/departments/studio/`, extracted from MCP's studio group
  (`packages/mcp-server/src/groups/studio.ts`: clip scope, `scope.plan`, sign, `scope.decide`). MCP keeps its exact
  behaviour and calls the adapter.
- Shorts: 3 per video, approved as a batch, cut only from an edit marked finished; AI long videos first (beats known),
  then the founder's own finished edits. The word is **short** in code and copy; `clips` stays the editor's table.
- Editing the founder's own video stays hands-on; the brain only cuts shorts from it after "Mark finished".
- Every paid step is behind a card with its price; the card snapshot rule of A0 applies (`approval_decide` refuses a
  changed card).

## 2. What ships

| # | Feature | The founder sees | Done when |
|---|---|---|---|
| F1 | Capability registry | nothing (code) | `packages/contracts/capabilities.json` lists every Studio entry point and today's CMO jobs with effect, approval, callers, order kind, max steps, credits; `check:contracts` validates it and fails on a caller path that is not listed |
| F2 | Studio adapter | nothing (MCP unchanged) | MCP's studio tools pass their current tests through the adapter; the brain and the Assistant call the same adapter |
| F3 | Pending Studio steps | a Studio card waits in the queue without the editor or a chat open | a priced step is stored (`studio_steps`), raises an approval card, and `approval_decide` runs it through the adapter |
| F4 | Video orders | the week plan shows a video order under Studio; the team node on the Dashboard moves | `plan_week` can plan a video item; a `build_video` order runs the long-take squad up to card 1 |
| F5 | Studio cards live | storyboard + price, contact sheet + video price, finished video in the queue | the four kinds decide live: `script`/`price` (approve, redo one keyframe, cancel), `finished_video` (approve = finished, open in editor, send back) |
| F6 | Finished state | "Mark finished" on Studio and in the editor; a finished badge | `editor_projects.finished_at` + the document hash it was marked at; editing after that clears it |
| F7 | Short render | nothing (code) | `render_document` renders each short's own edit from a brain order, with no editor open and no founder session |
| F8 | Shorts squad | a shorts batch card: 3 × 9:16 with hook and reason each | `cut_shorts` picks ranges (Clip editor), checks them (whole sentences, hook first, 15–60 s), builds one short per range, renders them; the batch card decides all three |
| F9 | Event rules | it just happens | finished video → `cut_shorts` order; shorts batch approved → each short a `short` deliverable ready for Schedule (P4); order states follow cards and renders |
| F10 | Acceptance | — | a local run: plan with a video → card 1 → approve → card 2 → approve → render → card 3 → approve → shorts batch card → approve; with the fake providers, no real money |

## 3. What exists (`cmo-build` at `992d632`)

- MCP studio group: `packages/mcp-server/src/groups/studio.ts` (272 lines): `PRICED` tools, `scope.plan` → signed
  step (`../confirm`) → `scope.decide`; `create_video`/`plan_video` take the client's plan.
- Clip scope: `apps/web/lib/agent/scope.ts` (`plan`, `decide`), long take: `lib/agent/create-video.ts`,
  `lib/agent/long-take.ts`; render: `request_export` → task `render_document` (`packages/clip-export`).
- Wave 1: `work_orders`, `deliverables` (`kind` already allows `video`, `short`), `work_order_events`, `approvals`
  (`kind` already allows `script`, `price`, `finished_video`, `shorts_batch`; `ref_kind` only the four wave-1 kinds),
  `approval_decide`, the screens route and loaders, the v2 cards on fixtures for every kind.
- `cmo_runs.kind` allows the eight CMO jobs; Studio work is not a `cmo_runs` kind today.
- No `cut_shorts`, no finished state, no `studio_steps`.
- Latest migration `20261227120000_brain_pause.sql`.
- Named timelines already exist in a document (`packages/editor-core/src/ops/timelines.ts`), which `studio.md` §7b
  meant for shorts ("copies the timeline, sets workarea, frame 9:16").

**Decided for this phase: a short is its own edit.** A new `clips` row (kind `short`) with its own document, pointing
at its parent edit and the range it was cut from. Rejected: a named timeline inside the finished document (as
`studio.md` §7b first sketched), because adding shorts would edit the finished document and break "any edit after
Mark finished clears it", and because a short is approved, scheduled and posted on its own. Named timelines stay the
editor's feature.

## 4. Global constraints

- Every write through an ownership-checking RPC; credits only through `credit_*`; a pgTAP test per migration and per
  transition; regenerate `supabase/schema/current.sql`. Migrations sort after `20261227120000`.
- Moderation on every prompt before credits and every frame after (unchanged squads keep it; the Shorts squad
  generates nothing).
- The peak-RAM budget holds for rendering three shorts: renders go through the existing `render_document` queue, at
  most the worker's parallel cap; measure peak RSS once in the acceptance run.
- English in all user-facing text; no model names; the brain never posts.
- MCP behaviour does not change (its tests are the guard).

## 5. Tasks

Tasks are numbered by session (A, B, C). Each session's file holds the checklist; this table is the overview.

| Task | Session | What | Waits on |
|---|---|---|---|
| **A0** | A | **Contracts first:** migration skeleton for `studio_steps`, `shorts`, new `approvals.ref_kind` values, `editor_projects.finished_at`/`finished_hash`; TS types in `lib/screens/approval-card.ts` for the four Studio card snapshots; `packages/contracts/capabilities.json` schema | — |
| **B0** | B | **Contracts first:** `lib/departments/studio/types.ts`: the adapter interface (`plan`, `decide`, `buildVideo`, `cutShorts`, `markFinished`, `renderShort`) and its input/output types | — |
| A1 | A | `studio_steps` RPCs and their approval snapshots; `approval_decide` for `script`, `price`, `finished_video`, `shorts_batch` | A0, B0 |
| A2 | A | Video orders: `plan_week` plans a video item; `build_video` and `cut_shorts` order kinds; the runner dispatches them to the adapter; order states follow steps, generations and renders | A1, B2 |
| A3 | A | Event rules (F9) and the finished state RPCs (`mark_finished`, cleared by `save_editor_document` when the hash changes) | A1 |
| A4 | A | Capability registry filled in (F1) and the `check:contracts` check | A0 |
| A5 | A | Screen loaders: Studio items from `studio_steps`, `shorts` and finished edits; Dashboard Studio node; Brain orders | A2, A3 |
| A6 | A | Acceptance run (F10) with screenshots of the live Dashboard and Studio | everything |
| B1 | B | Extract the adapter from MCP's studio group; MCP calls it; MCP tests pass unchanged | B0 |
| B2 | B | `buildVideo(brief)`: video brief → `create_video` input (prompt, seconds, aspect, voice, Brand Kit, strategy voice); the long-take squad's steps as `studio_steps` | B1, A1 |
| B3 | B | Short render (F7): `render_document` for a short's own edit, queued by the adapter for a brain order | B0 |
| B4 | B | Shorts squad (F8): Clip editor agent (registry agent `shorts`), Clip reviewer (code), Builder (`make_short` op in `editor-core`: copy the timeline range, 9:16 frame), Renderer (B3) | B1, B3, A0 |
| C0 | C | Card bodies on A0's types with fixtures: `script`, `price`, `finished_video`, `shorts_batch` (states, redo one keyframe, open in editor) | A0 |
| C1 | C | Cards decide live through `POST /api/v1/approvals/[id]` with the new actions | C0, A1 |
| C2 | C | Mark finished on Studio and in the editor's top bar; the finished badge; "Cut shorts" on a finished edit | A3 |
| C3 | C | Studio page live: generated videos, shorts batches, finished edits (from A5); the Video team panel reads the order's steps | A5 |
| C4 | C | e2e for F5, F6, F8 on live rows | C1–C3 |

**Milestones**
- **M1** contracts: A0 and B0 pushed; the planner reviews them before A1, B1 or C0 build on them.
- **M2** the long-take path live: A1, A2, B1, B2, C0, C1 (cards 1–3 decide live).
- **M3** shorts and acceptance: A3–A6, B3, B4, C2–C4; the planner reviews the whole PR.

## 6. Review focus

- MCP's behaviour is unchanged (same tools, same signed steps, same results).
- A Studio card decided from a stale screen is refused; redoing one keyframe raises a new card and keeps the order
  waiting.
- No credit moves without a card; a cancelled step releases its hold.
- A finished mark is cleared by any later edit; shorts are cut only from a finished edit.
- Rendering three shorts stays inside the worker's parallel cap and the 2 GB budget.
