# Session B: Threads chain, captions, repurpose, photo post — then review and screenshots

Plan: [`../2026-11-12-daily-core-drafts-plan.md`](../2026-11-12-daily-core-drafts-plan.md) Tasks 4, 6, 7, 9. Rules:
[`README.md`](README.md) (branch, shared files, rulings, migration numbers).

**Owns:** `apps/web/lib/departments/publish/split.ts` (new), `zernio.ts` (all but `SLUG.facebook`), `lib/cmo/jobs/publish-post.ts`,
the schedule card component, the `approvals_autopilot` trigger, `lib/cmo/writer/**`, the script card and Script tab,
`lib/cmo/jobs/repurpose-post.ts` (new), `post_variants` and `schedule_content`, the post card's Rewrite button,
`components/today/PhotoPostPanel.tsx` (new), `app/api/v1/photo-posts/` (new), `lib/cmo/skills/no-ai-slop.check.ts`.

**Order and waits:**

- [ ] Task 4: Threads chain, long X posts, autopilot. Waits on nothing.
- [ ] Task 6: caption with every video script. Waits on nothing.
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
