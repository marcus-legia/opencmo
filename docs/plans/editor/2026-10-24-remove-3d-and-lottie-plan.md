# Remove 3D (three.js) and Lottie: Remotion is the one way to make motion

Status: **plan, not started** (owner, 2026-10-24: "remove 3D, three.js and Lottie from the project; only Remotion").
Depends on: the motion studio refactor (`2026-10-24-motion-studio-refactor.md`) being merged and deployed, so the
replacement (styles, the kit core, free drawing) is live before anything is taken away.

## Why

- Explainers and motion clips are now Remotion scenes the model writes itself; the guide no longer offers Lottie, and
  3D adds a second renderer (`clip-three`, a GPU function on Modal) the CLAUDE.md rule "one runtime" argues against.
- Every extra path is code to keep secure and working: three.js scene code runs on a GPU worker, Lottie JSON is parsed in
  three renderers (`clip-render`, `clip-export`, `clip-motion`). Fewer paths, fewer bugs.
- What they did is covered: 3D depth → CSS perspective/rotateX/Y in Remotion (the `product-ui` style), Lottie
  micro-animations → drawn SVG with `kit.drawOn`, `kit.travel`, `Streak`.

## What exists today (inventory, 2026-10-24)

| Piece | Where | Used by |
|---|---|---|
| 3D Studio model `studio-3d` | `packages/contracts/ai-models.json`, SQL `ai_models` (migrations `20261007090000_studio_3d.sql`, `20261010090000_scene_codes.sql`, `20261011090000_agent_3d_hold.sql`) | `add_3d_scene` / `preview_3d` tools (Assistant + MCP), `apps/web/components` (3D panel), credit holds |
| `packages/clip-three` | three.js scenes, spike, scripts | Modal GPU render function in `packages/engine/modal_app.py`, `opencmo` engine |
| Lottie layers in the editor document | `packages/clip-doc/src/schema.ts` (an entity kind), `editor-core` (`add_lottie` op, `visuals/lottie.ts`, intro motion `motion/intro.ts`), `clip-render` (`tree.ts`, `frame.ts`), `clip-export` (`look.ts`) | users' saved documents, the intro recipe (`MOTION_DIRECTOR` names Lottie elements) |
| Lottie in explainers | `packages/clip-motion/src/kit/lottie.tsx`, `lotties.ts`, `@remotion/lottie` | old scenes; the guide no longer offers it |
| Lottie files | `packages/clip-media/lottie/` (copied into the motion bundle and the web public dir), `apps/web/scripts` | `find_lotties`, the editor library |

## Phases (each its own PR, in this order)

### Phase 1: stop offering (no data change, reversible)
- Remove `add_3d_scene`, `preview_3d`, `add_lottie`, `find_lotties` from the Assistant's tool set (`apps/web/lib/agent/
  tools.ts`, `scope.ts`, `prompt.ts`, `limits.ts`) and from MCP (`packages/mcp-server/src/groups/studio.ts`,
  `explainer.ts`); drop them from guides (`3d`, `visuals`, `intro`), the system prompt routing and slash commands.
- `get_explainer_kit`: drop `lotties`. kit: keep `Lottie` rendering for old scenes but list it nowhere.
- Disable `studio-3d` with a migration (`enabled = false`; keep the row: generations and refunds reference it), mirror in
  `ai-models.json`. pgTAP test: the model cannot be held for credits.
- The intro recipe: replace Lottie elements in `MOTION_DIRECTOR` / `editor-core/motion/intro.ts` with drawn accents.
- Hide the 3D panel and the Lottie library tab in the editor UI.
- Evals, checks and the fake provider updated; landing copy checked for 3D/Lottie claims ("don't ship coming soon").

### Phase 2: existing documents (needs the owner's decision first)
- Measure first: how many saved documents contain a Lottie layer, and how many users (read-only query on production).
- Then one of:
  - **A. Convert** each Lottie layer to a video asset rendered once (Remotion, transparent WebM/ProRes) and swap the
    entity for a video layer at the same place and time — nothing visible changes for the user. Cost: a one-off job.
  - **B. Drop** the layers with a document migration (`clip-doc` migrations) and a note in the version history — only if
    the count is near zero.
- Recommendation: A unless Phase 2's count is under ~20 documents of test accounts.

### Phase 3: delete the code
- Delete `packages/clip-three`, its Modal GPU function and image, its secret keys (`check_deploy_env.py`), and the 3D
  engine paths; delete `@remotion/lottie`, `kit/lottie.tsx`, `lotties.ts`, Lottie support in `clip-render`,
  `clip-export`, `clip-doc` (after Phase 2 migrated every document), `packages/clip-media/lottie/`.
- `THIRD_PARTY_NOTICES.md`: remove the LottieFiles motion-design-skill row only if the adapted text is gone too (the
  `EXPLAINER_MOTION` personality text came from it — keep the notice while that text stays).
- Docs: CLAUDE.md layout list (`clip-three`), research/plan docs keep history.

## Verify (each phase)

`npm run typecheck && npm run build`; `npm run check:clip-motion`; `npm run test:editor-core`; `npm run check:mcp-server`
and `cd packages/mcp-server && npm test`; `cd apps/web && npm run check:contracts`; fake eval; `npm run db:reset &&
npm run db:test` for the migration; render an old document with a Lottie layer before and after Phase 2 and look at it.

## Deploy

Phase 1: `supabase db push` (disable `studio-3d`) → worker and MCP `modal deploy` → Vercel. Phase 3 also removes the
GPU function: `modal app` keeps no orphan endpoint; stop old containers.

## Open questions for the owner

1. Phase 2: convert old Lottie layers (A) or drop them (B)? (Answer after the count.)
2. Keep Lucide icons as a small-symbol library? (Recommended: yes — they are plain SVG paths in Remotion, not a second
   runtime.)
3. Already-generated 3D videos in users' libraries stay as ordinary videos (no change needed) — confirm.
