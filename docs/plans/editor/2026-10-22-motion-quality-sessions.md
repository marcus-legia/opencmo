# Motion quality: work split for two sessions, one PR

Plan: [`2026-10-22-motion-quality-plan.md`](2026-10-22-motion-quality-plan.md) — read it first, all of it.
Research: [`docs/research/editor/2026-10-22-motion-quality-opus-claude-design.md`](../../research/editor/2026-10-22-motion-quality-opus-claude-design.md).
Branch: **`plan/editor/2026-10-22-motion-quality`** · PR: [#104](https://github.com/marcus-legia/opencmo/pull/104) (draft), shared by both sessions.

- **Session A — Spec, loop, real images:** tasks A0–A6. Lands the shared contracts first (A1).
- **Session B — Templates and silent clips:** tasks B1–B6. Starts on code that needs only A1, and picks up the tool
  and SQL work once A's matching tasks are pushed.

## Rules for both sessions

1. **Own your paths** (below). A file listed under "Shared" may be edited by both, but only in the named function
   or block; `git pull --rebase` right before editing it and push right after.
2. **Same branch, no force.** `git pull --rebase origin plan/editor/2026-10-22-motion-quality` before every push;
   never `--force`; never rebase pushed commits; never push to `main`.
3. **Small commits, prefixed** `[A]` or `[B]`, English messages, each green on its own (typecheck + the tests of the
   packages it touches). End with the attribution lines your tooling gives you.
4. **Tick your checklist** below in the same commit that finishes an item (only your own section).
5. **Repo rules apply** (CLAUDE.md): one motion runtime (`clip-motion`); the scene sandbox stays closed; English
   everywhere, including comments you touch; comments explain why. Licences: copy only from
   `opus-pro/opusclip-video-tools/remakes/**` (MIT, notice in `THIRD_PARTY_NOTICES.md`); learn-only from its
   `plugins/**` and from the Claude Design prompt.
6. **Migrations in order.** A's `20261223090000_motion_assets.sql` lands before B writes
   `20261223100000_motion_clip.sql`; B's redefinition of the spec check keeps A's asset check. Whoever commits a
   migration regenerates `supabase/schema/current.sql` on top of the other's.
7. **Heavy suites one at a time** on one machine (`npm run build`, `db:reset`/`db:test`, renders, e2e).
8. **Do not deploy.** The plan's last section lists what the owner deploys, in order.
9. **Verify by looking.** A6 and B6 end with full-size frames in the frames folder, looked at, and posted in the PR.

## Shared contracts (Session A lands these in A1)

Exactly as in the plan, Task A1 "Interfaces": `MOTION_KINDS`, `AssetSchema`, the limits, `BeatSchema.seconds`,
`MotionJobSchema.{kind, stills, assets}` in `packages/clip-motion/src/job.ts`; `MOTION_CLIP_MODEL`,
`MotionAssetRefSchema`, `ClipBeatSchema`, `ClipSceneSchema`, `clipSeconds` and `ExplainerSceneSchema.assets` in
`packages/editor-core/src/explainer.ts`. B codes against these from its first commit; A changes them only after a
"Requests" note both sessions agree on.

Tool fields, final shape (A3 and A5 add theirs, B3 adds `silent` and beat `seconds`):
`preview_explainer { title, beats[{say, label?, visual, seconds?}], direction, code, format, theme?, personality?, assets?[{name, image}], silent?, times? }`;
`add_explainer` = the same without `times`, plus `voice` (absent when `silent`) and `start?`.

## Session A — Spec, loop, real images

**Owns:** `packages/clip-motion/src/{job.ts,errors.ts,preview.ts,layout.ts,assets-inline.ts,render.ts,cli.ts}`, `apps/web/.env.example`, `packages/engine/.env.example`,
`packages/clip-motion/src/kit/{timing.ts,image.tsx}`, their tests; `packages/editor-core/src/explainer.ts` and its
test; `apps/web/lib/motion/**`; `apps/web/lib/agent/{motion-guide.ts,scope.ts}`; `packages/mcp-server/src/groups/{studio.ts,guides.ts}`;
`packages/engine/opencmo/deploy_env.py` and its test; `supabase/migrations/20261223090000_*`, `supabase/tests/195_*`;
`docs/plans/editor/2026-10-22-motion-quality-frames/{baseline,after-a}/`.

**Order:** A0 → A1 (push at once) → A4 → A2 → A3 → A5 → A6.

- [x] A0 Baseline frames
- [x] A1 Shared contracts
- [x] A4 `kit.Image` and safe inlining
- [ ] A2 Preview at chosen times, jump check
- [ ] A3 `direction`, `times`, review checklist (tools, guides, MCP limit)
- [ ] A5 Assets through tools, SQL and render
- [ ] A6 After frames, RAM measured

## Session B — Templates and silent clips

**Owns:** `packages/contracts/ai-models.json`;
`packages/clip-motion/src/kit/devices.tsx`, `packages/clip-motion/src/remotion/fonts.ts`,
`packages/clip-motion/templates/**`, `packages/clip-motion/src/templates.test.ts`;
`packages/editor-core/src/ops/explainer.ts`; `packages/mcp-server/src/groups/explainer.ts`;
`supabase/migrations/20261223100000_*`, `supabase/tests/196_*`; `THIRD_PARTY_NOTICES.md`;
`docs/plans/editor/2026-10-22-motion-quality-frames/after-b/`.

**Order:** B4 (after A4 is pushed; until then build the frames with `children` only) → B5 → B2 → B1 (after A5 is
pushed) → B3 (after A3 and A5) → B6.

- [ ] B4 Display face, phone and browser frames
- [ ] B5 Template library (3 ports) + `list_motion_templates` / `get_motion_template`
- [ ] B2 Clip timing and the silent worker path
- [ ] B1 `motion-clip` in the catalog and SQL
- [ ] B3 `silent` in the tools and the op
- [ ] B6 OpenCMO logo reveal + phone carousel, after frames

## Shared files

| File | A edits | B edits |
|---|---|---|
| `apps/web/lib/agent/explainer-tool.ts` | A3: `direction`, `times`, `DIRECTION_HELP`, `REVIEW_CHECKLIST`, `PREVIEW_ROUNDS`; A5: `assets` | B3: `silent`, beat `seconds`, the `motion-clip` branch of `prepareExplainer`; B5: the two template tools |
| `apps/web/lib/agent/explainer-tool.check.ts` | A3, A5 cases | B3, B5 cases |
| `apps/web/lib/agent/guides.ts` (guide `explainer` only) | A3: the direction → preview → checklist steps | B3: when to make a silent clip; B5: start from a template |
| `packages/clip-motion/src/kit/index.ts` | A4: `Image`, `images` | B4: `Phone`, `Browser`, `font` |
| `packages/clip-motion/src/kit/timing.ts` | A2: `previewFrames`, `pairedProbes` | B2: the `kind === 'clip'` branch of `buildTimeline` |
| `packages/clip-motion/src/golden.test.ts` | A4 image cases | B4 device cases |
| `packages/engine/opencmo/ai/providers/motion.py` + `tests/test_ai_motion_provider.py` | A4: `motion_assets`, assets in `motion_job` | B2: the `clip` template branch (no voice) |
| `supabase/schema/current.sql` | after A5 | after B1, on top of A5 |

## Requests

(Write here when you need the other session to change something it owns. Date, from, what, why.)
