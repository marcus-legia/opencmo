# Session B: Threads chain, captions, repurpose, photo post — then review and screenshots

Plan: [`../2026-11-12-daily-core-drafts-plan.md`](../2026-11-12-daily-core-drafts-plan.md) Tasks 4, 6, 7, 9. Rules:
[`README.md`](README.md) (branch, shared files, rulings, migration numbers).

**Owns:** `apps/web/lib/departments/publish/split.ts` (new), `zernio.ts` (all but `SLUG.facebook`), `lib/cmo/jobs/publish-post.ts`,
the schedule card component, the `approvals_autopilot` trigger, `lib/cmo/writer/**`, the script card and Script tab,
`lib/cmo/jobs/repurpose-post.ts` (new), `post_variants` and `schedule_content`, the post card's Rewrite button,
`components/today/PhotoPostPanel.tsx` (new), `app/api/v1/photo-posts/` (new), `lib/cmo/skills/no-ai-slop.check.ts`.

**Order and waits:**

- [x] Task 4: Threads chain, long X posts, autopilot. Waits on nothing.
- [x] Task 6: caption with every video script. Waits on nothing.
- [ ] Task 7: repurpose on demand. **Waits on A's Task 3** (fan-out slots per target) — check `A.md`.
- [ ] Task 9: photo post. **Waits on A's Task 5** (`schedule_propose` with Facebook; your migration redeclares it after A's).
- [ ] Whole-branch code review once every box in `A.md` and here is ticked: run `/code-review` (high) on the PR's diff
  against `main`, fix what it finds in one round, re-review the fixes once, and list what is left in the PR.
- [ ] Screenshots for the owner, in `shots-B/` and in the PR description: the planner panel (X, Threads, LinkedIn,
  Facebook, TikTok rows), a day's core post card with its targets, the schedule cards it fans out to, a Threads chain
  preview, the X "Post as a thread" failure card, a script card with its caption, the Rewrite for LinkedIn button and
  its result, the photo post panel. Use sample data if no live account; say so under each image. Send them to the
  owner with SendUserFile too.

Each task: tests first, commit, push (see README). Tick the box in this file in the task's own commit.

## Notes for A and the owner

- **Task 4, what differs from the plan.** The X failure is carried by the error code `too_long` (new in
  `PUBLISH_ERROR_CODES`), not a `retry: "as_thread"` field: `publish_status` keeps only `code`, `message` and
  `retryable`. "Post as a thread" sets the slot's new option `as_thread` through `set_options`, so a new card shows the
  cut posts and the founder approves them (nothing goes out that was not seen). A thread is offered up to 25 posts.
- **Small edits in A's files** (one or two lines each, keep them on a conflict): `lib/departments/publish/types.ts`
  (`too_long` code, `asThread` on the non-TikTok platform fields) and `accounts.ts` (`too_long` → 422).
- **Autopilot and targets.** `post_is_threads_chain` also reads `body.targets`: a core post over 500 characters whose
  targets include `threads` gets no `auto_at` on any platform, because approving it also schedules the Threads chain.
- **Not verified against Zernio:** `threadItems` for Threads (the plan's shape; the repo's notes confirm it for X only)
  and the words of X's "too long" refusal. `zernio.com` is not reachable from the cloud session. The matcher is
  `saysTooLong` in `publish/split.ts`; check both on a real account before the owner's test.
- **Local database.** Docker cannot pull the Supabase image here, so pgTAP ran on a plain Postgres 16 with a small
  shim for `auth`, `storage` and the roles. `182_*` fails its second case there with and without this branch (default
  grants differ); CI's run is the authoritative one.
- **Task 6 needed a migration the README did not number:** `20270120027000_script_caption` (pgTAP `306_script_caption`).
  `work_orders_brief_rules` copies named keys from Writer's brief onto the order, so `caption` is added there. **A:** if
  Task 8 redefines `work_orders_brief_rules`, start from this version or the caption is lost. The script card reads the
  caption from the order when it loads (`schedule-enrich.ts`), so `approval_snapshot` is untouched.
