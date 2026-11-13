# Sessions for the core drafts follow-ups

Plan: [`../2026-11-13-core-drafts-followups-plan.md`](../2026-11-13-core-drafts-followups-plan.md). Three sessions,
**one remote branch `claude/stoic-planck-zlphv6`, one PR**. No session opens its own branch or PR.

Each session: `git fetch origin claude/stoic-planck-zlphv6`, work on a local branch from it,
`git pull --rebase origin claude/stoic-planck-zlphv6` before each task and before each push, then
`git push origin HEAD:claude/stoic-planck-zlphv6`. Never force-push. Commit and push each task when it is green; tick
its box in your own session file in the same commit.

| Session | Tasks | File |
|---|---|---|
| A | 1 (the main flow, tested) | [`A.md`](A.md) |
| B | 2 (published at the first platform), 3 (photo draft cleanup) | [`B.md`](B.md) |
| C | 4 (remove "Write a slideshow"), 5 (Zernio's documents, the owner's checklist) | [`C.md`](C.md) |
| Controller (wrote the plan) | the whole-branch review at the end | plan, "Review" |

Nobody waits on anybody: the three sessions start at once. A's pgTAP file is written against the rule of Task 2
(F1); if B has not pushed Task 2 when A is done, A leaves the two F1 assertions marked `-- needs 309` and says so.

## Migration and test numbers (no collisions)

| Owner | Task | Migration | pgTAP |
|---|---|---|---|
| B | 2 | `20270121010000_post_published_first` | `309_post_published_first` |
| B | 3 | `20270121020000_photo_draft_cleanup` | `310_photo_draft_cleanup` |
| C | 4 | `20270121030000_drop_write_slides` | `311_drop_write_slides` |
| A | 1 | none | `312_core_draft_flow` |

## Shared files

- `supabase/schema/current.sql`: never merge it by hand. After a rebase that touches it, apply every migration to your
  local database again, run `scripts/dump-schema.sh`, and commit the result.
- `supabase/tests/182_authenticated_function_allowlist.test.sql`: add only your own new founder-callable function, on
  its own line. (None is expected in this plan: every new function is internal or for the service role.)
- `apps/web/package.json` (`check:contracts`): add only your own new check file.
- `supabase/tests/308_review_fixes.test.sql`: B only.

## SQL functions, one owner each

| Function | Owner |
|---|---|
| `publish_status`, `schedule_mark_posted`, `schedule_follow_content`, `schedule_propose`, `schedule_take_proposal`, `post_slots_open`, `schedule_slots_settle_post` | B (Task 2) |
| `photo_post_create`, `photo_post_save`, new `photo_draft_release`, `photo_drafts_sweep` | B (Task 3) |
| `cmo_job_price`, `cmo_job_daily_limit`, `enqueue_cmo_run` | C (Task 4) |

A redefines nothing.

## Rulings already made (the controller, 2026-11-13)

1. Decisions F1 and F2 are the controller's recommendation and wait for the owner's word on the PR. Build them; if the
   owner says no, the task's commit is reverted, nothing else depends on it.
2. A session that cannot run the Supabase stack runs what it can (see the plan's Global constraints) and writes in its
   own file exactly which commands it ran and which it could not. A box is ticked only for what was run or what CI ran.
3. A finding outside your task goes in your session file under "Seen, not mine", not into another session's files.
