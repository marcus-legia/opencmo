# Sessions for the daily core drafts plan

Plan: [`../2026-11-12-daily-core-drafts-plan.md`](../2026-11-12-daily-core-drafts-plan.md). Two sessions, **one remote branch
`claude/social-media-autopilot-issue-d7117d`, one PR**. Each session works in its own worktree on a local branch and
pushes to that remote branch: `git pull --rebase origin claude/social-media-autopilot-issue-d7117d` before each task and
before each push, then `git push origin HEAD:claude/social-media-autopilot-issue-d7117d`. Never force-push.

| Session | Tasks | File |
|---|---|---|
| A (the session that wrote the plan) | 1 (done), 2, 3, 5, 8, the Rules-and-docs block | [`A.md`](A.md) |
| B | 4, 6, 7, 9, then the whole-branch code review and the screenshots | [`B.md`](B.md) |

**Shared files** (both sessions touch them; take the other session's version and redo your own lines on a conflict):

- `supabase/schema/current.sql`: never merge it by hand. After a rebase, run `npm run db:reset` and
  `scripts/dump-schema.sh`, and commit the result.
- `packages/contracts/capabilities.json`: A removes `build_slideshow` (Task 8); B adds `repurpose_post` (7) and
  `photo_caption` (9). Different entries.
- `apps/web/lib/cmo/jobs/types.ts`: B adds job kinds `repurpose_post`, `photo_caption`; A does not add kinds.
- `apps/web/lib/departments/publish/zernio.ts`: A adds `SLUG.facebook` (5) only; B owns the rest of the file (4, 9).

## Rulings already made (the plan's controller, 2026-11-12)

1. Phase A's `TEXT_PLATFORMS = ["x", "threads", "linkedin"]`. Task 5 (A) adds `"facebook"` to `TEXT_PLATFORMS`, to
   `save_posting_plan`'s key set (a new migration), to the planner row and to the `schedule_propose` fan-out.
2. Task 2 writes a new migration `20270120015000_posting_plan_retarget.sql`; no applied migration is edited.
3. The Rules-and-docs block (CLAUDE.md, `docs/architecture/ai-cmo.md` + HTML twin) rides with Task 3 (A).
4. `profiles.posting_plan` is writable only through `save_posting_plan` (profiles has a SELECT policy and no UPDATE
   grant).
5. Full `npm run db:test` crashes Postgres locally at `098_generations`, also without this branch's migrations
   (pre-existing). Run the test files you touched and `182_*`; CI's run is the authoritative one.

## Migration and test numbers (no collisions)

| Owner | Task | Migration | pgTAP |
|---|---|---|---|
| A | 1 (done) | `20270120010000_posting_plan` | `299_posting_plan` |
| A | 2 | `20270120015000_posting_plan_retarget` | cases in `299_posting_plan` |
| A | 3 | `20270120020000_post_targets` | `300_post_targets` |
| B | 4 | `20270120025000_autopilot_threads_chain` | `301_autopilot_threads_chain` |
| A | 5 | `20270120030000_facebook` | `303_facebook` |
| B | 7 | `20270120040000_post_variants` | `302_post_variants` |
| A | 8 | `20270120050000_drop_slideshow_order` | `305_drop_slideshow_order` |
| B | 9 | `20270120060000_photo_post` | `304_photo_post` |
