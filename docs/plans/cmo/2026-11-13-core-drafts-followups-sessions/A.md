# Session A: the main flow, tested end to end

Plan: [`../2026-11-13-core-drafts-followups-plan.md`](../2026-11-13-core-drafts-followups-plan.md) Task 1. Rules:
[`README.md`](README.md).

**Owns:** `supabase/tests/312_core_draft_flow.test.sql` (new), `apps/web/e2e/ui-v2-core-drafts.spec.ts` (new), one new
seed function in `apps/web/e2e/ui-v2-seed.ts`, one new block in `apps/web/lib/cmo/jobs/jobs.check.ts`, one new step in
`apps/web/lib/screens/p6-acceptance.e2e.ts`. Writes no migration and redefines no SQL function.

- [x] Step 1: pgTAP `312_core_draft_flow` (plan → targets → one card → approve → three slots → published; and with no
  account at all)
- [x] Step 2: `jobs.check.ts` (one draft run for a three-platform slot)
- [ ] Step 3: Playwright `ui-v2-core-drafts.spec.ts` (run locally, or written and marked not run) — **written, not run**
  (no Supabase stack here; see below)
- [ ] Step 4: the Phase A step in `p6-acceptance.e2e.ts` — **written, not run** (needs GoTrue and PostgREST)
- [x] Step 5: commit and push

A test that fails because the product is wrong is a finding: write it under "Found" below with the steps, leave the
assertion in, and do not change another session's code to make it pass.

## What I ran, what I could not

- The cloud container has no Docker, so no Supabase stack. I ran Postgres 16 from the distribution with pgTAP from apt,
  a bootstrap that stands in for Supabase (the roles, `auth.users`, `auth.uid()` reading `request.jwt.claims` as
  GoTrue's does, a minimal `storage` schema), applied all 224 migrations in order (`psql -1 -v ON_ERROR_STOP=1`), and
  ran `298`–`308` (all green) and `312`. CI's `database (Supabase)` job is the authoritative run.
- `312_core_draft_flow`: 29 of 30 pass; test 23 is a pgTAP TODO (`needs 309`, decision F1), so the suite stays green
  until Session B's Task 2 lands and the TODO starts passing. Then the `todo_start`/`todo_end` pair can go.
- `jobs.check.ts`: `NODE_OPTIONS=--conditions=react-server npx tsx lib/cmo/jobs/jobs.check.ts` passes; I flipped the
  one-draft assertion once to see the new block fail, then put it back.
- `apps/web`: `npx tsc --noEmit` is clean with the new spec, the seed function and the p6 step.
- **Not run:** `ui-v2-core-drafts.spec.ts` (`npm run test:e2e:v2`) and `p6-acceptance.e2e.ts` (its own command in the
  file's header). Both need GoTrue (`auth.admin.createUser`, sign-in) and PostgREST, which only the Supabase stack
  gives, and CI does not run them. Their boxes stay open for a session with Docker. What each asserts:
  - the spec: the planner has seven rows with a logo each, "More posts a day on LinkedIn" saves 2 a day to
    `profiles.posting_plan`; the Feed row of the seeded three-target post reads "Post for 3 platforms", its card lists
    X, Threads and LinkedIn; Approve gives X's slot decided with the post and a waiting card each for Threads and
    LinkedIn, both on the Feed after a reload; the icon next to Refresh lands on `/app/schedule#posting-plan`.
  - p6 `coreDraftDay()`: `plan_week` from the schedule (fake brain) → one `post_draft` run, every post item targets the
    three platforms, one post card → approved through `approval_decide` → three schedule cards.
- "Three schedule cards" (the plan's words) are three `schedule_slot` approvals: X's is `approved` with the post card
  (its time was on that card, cmo-review-3 1.2), Threads' and LinkedIn's are `waiting`. Both tests assert exactly that.

## Found

- **Under the current rule a post loses its link when its last platform is closed by hand.** X and Threads post
  through Zernio, LinkedIn is copy and open and the founder marks it posted: `publish_status` did not mark the post
  `published` (LinkedIn was still open), and `schedule_mark_posted` marks it `published` without a URL. The post ends
  `published` with `external_url` null, so `pull_metrics` can match it only by its opening words. Steps: `312` §4.
  Decision F1 (Task 2) fixes it, since X's `publish_status` then publishes the post with X's link; `312` test 23
  asserts the link inside the F1 TODO.

## Seen, not mine
