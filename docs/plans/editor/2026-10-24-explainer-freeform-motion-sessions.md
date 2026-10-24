# Explainer free-form motion: work split for two sessions, one PR

Plan: [`2026-10-24-explainer-freeform-motion-plan.md`](2026-10-24-explainer-freeform-motion-plan.md) — read it whole
before starting; this file only says who does what.

Branch: **`plan/editor/2026-10-24-explainer-freeform-motion`**, shared by both sessions, one PR to `main`.

## Rules for both sessions

- Each session works in its **own working tree** (two sessions in one tree overwrite each other's files). Session A
  uses the main checkout `~/code/opencmo`, which has the branch checked out. Git allows a branch in only one worktree,
  so Session B uses a local branch of its own that pushes to the shared one:
  `git fetch origin && git worktree add -b explainer-freeform-b ../opencmo-b origin/plan/editor/2026-10-24-explainer-freeform-motion`,
  then `npm install` there. B syncs with `git pull --rebase origin plan/editor/2026-10-24-explainer-freeform-motion`
  and pushes with `git push origin HEAD:plan/editor/2026-10-24-explainer-freeform-motion`.
- Touch only the files your session owns (table below). Need a change in the other session's file → write it under
  "Requests" at the end of this file, commit, push; the owner of the file does it.
- `git pull --rebase` before every push (B: with the remote branch named, see above). Small commits, one per task step 5 of the plan.
- Run heavy suites one at a time (`npm run check:clip-motion` renders video; don't run it while the other session's
  build or render is running on the same machine).
- Tick the checkbox here when a task is committed and pushed.
- Do not deploy. The deploy order is at the end of the plan; the owner runs it after merge.

## Shared contracts (fixed now, so both sessions start at once)

- Component: `kit.Mark` — props `name, x, y, w, h, at?, dur?, exitAt?, exitDur?, children`; x, y = top-left in
  composition pixels (same as `kit.Image`); tagged `data-box="mark"`, `data-name="Mark <name>"`.
- Layout message (verbatim): `Beat ${n} shows nothing drawn: draw what its narration names (a Mark you draw, a shape, an icon).`
  The guide quotes it as `"beat N shows nothing drawn"`.
- Module `@opencmo/clip-motion` exports `EXPLAINER_EXAMPLE: string` and
  `EXPLAINER_EXAMPLE_BEATS: { say: string; label: string; visual: string }[]` from `src/guide-example.ts`.
  **Session A pushes A1 with a first version of this module** (any scene that compiles and uses `Mark`), so Session B
  can import it right away; A replaces the scene in A3 without changing the export names.

## Session A — kit, layout report, example scene (`packages/clip-motion`)

Plan tasks 1, 2 (clip-motion part), 4 (scene + test), 5 step 3 (frames).

- [x] A1 Plan Task 1: `kit.Mark`, `MOVES_INSIDE`, new `beatIssues` message, tests; plus the first `guide-example.ts`
  and its re-export from `src/index.ts` (contract above). Push as soon as `npm run check:clip-motion` is green.
- [x] A2 Plan Task 2, `preview.ts` only (nothing to change: no user-facing string there names icons; the review checklist lives in `explainer-tool.ts`, see Request 1): reword user-facing review/checklist strings that name icons or Lotties as the subject.
- [x] A3 Plan Task 4: the real "Why the sea looks flat" scene and the `guide example` golden test (clean layout report,
  a `Mark` in every beat). Look at the stills.
- [ ] A4 Plan Task 5 step 3, **after B3 is pushed**: before (`main`) / after (branch) frames of the flat-earth prompt
  over a local MCP client, saved to `docs/plans/editor/2026-10-24-explainer-freeform-frames/{before,after}/`.
  If "after" still looks like icon medallions, write a Request for B with what the guide should say instead.

## Session B — guide, tool schemas, MCP, eval (`apps/web/lib/agent`, `packages/mcp-server`)

Plan tasks 2 (guide part), 3, 4 (wiring into the guide), 5 steps 1-2.

- [x] B1 Plan Task 3: rewrite the `explainer` guide, `EXPLAINER_MOTION`, `visual` describe, `read_first`,
  `kit-explainer` resource description, with the checks in `agent-design.check.ts` and `server.check.ts`.
  Include Task 2's §4 bullet (`"beat N shows nothing drawn"`) and its two asserts.
- [ ] B2 Plan Task 4 wiring: replace the guide's icon-only "Example:" block with `${EXPLAINER_EXAMPLE}` (after A1 is
  pushed: `git pull --rebase`). Nothing to redo when A3 replaces the scene.
- [ ] B3 Plan Task 5 steps 1-2: `drawable(visual, code)` in `eval/tasks.ts` and its fake case; fake eval green.
- [ ] B4 Open the PR when A1-A3 and B1-B3 are ticked: Vietnamese title/description are not required here (not a
  research report) — English, with the frames from A4 side by side and the deploy order copied from the plan.

## File ownership

| File | Owner |
|---|---|
| `packages/clip-motion/src/kit/mark.tsx`, `kit/index.ts`, `layout.ts`, `preview.ts`, `guide-example.ts`, `index.ts` | A |
| `packages/clip-motion/src/golden.test.ts`, `layout.test.ts` | A |
| `docs/plans/editor/2026-10-24-explainer-freeform-frames/` | A |
| `apps/web/lib/agent/guides.ts`, `motion-guide.ts`, `explainer-tool.ts`, `agent-design.check.ts`, `eval/tasks.ts` | B |
| `packages/mcp-server/src/groups/explainer.ts`, `groups/guides.ts`, `server.check.ts` | B |
| this file (ticks and Requests only) | both |

## Requests

1. **A → B, `apps/web/lib/agent/explainer-tool.ts` `REVIEW_CHECKLIST`**: add a line after 1 (Subject):
   `"2. Drawing: is the subject drawn as itself (its silhouette, depth and its own motion in a Mark), not a stock icon in a ring or a medallion?"`
   and renumber the rest. Without it the review never asks for the quality the plan is about. (Assert it in
   `explainer-tool.check.ts`.)
   **Done (B, with B1).**
