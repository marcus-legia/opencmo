# Session A: the main flow, tested end to end

Plan: [`../2026-11-13-core-drafts-followups-plan.md`](../2026-11-13-core-drafts-followups-plan.md) Task 1. Rules:
[`README.md`](README.md).

**Owns:** `supabase/tests/312_core_draft_flow.test.sql` (new), `apps/web/e2e/ui-v2-core-drafts.spec.ts` (new), one new
seed function in `apps/web/e2e/ui-v2-seed.ts`, one new block in `apps/web/lib/cmo/jobs/jobs.check.ts`, one new step in
`apps/web/lib/screens/p6-acceptance.e2e.ts`. Writes no migration and redefines no SQL function.

- [ ] Step 1: pgTAP `312_core_draft_flow` (plan → targets → one card → approve → three slots → published; and with no
  account at all)
- [ ] Step 2: `jobs.check.ts` (one draft run for a three-platform slot)
- [ ] Step 3: Playwright `ui-v2-core-drafts.spec.ts` (run locally, or written and marked not run)
- [ ] Step 4: the Phase A step in `p6-acceptance.e2e.ts`
- [ ] Step 5: commit and push

A test that fails because the product is wrong is a finding: write it under "Found" below with the steps, leave the
assertion in, and do not change another session's code to make it pass.

## What I ran, what I could not

## Found

## Seen, not mine
