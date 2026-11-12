# Session A: planner, core post, fan-out, Facebook, slideshow removal

Plan: [`../2026-11-12-daily-core-drafts-plan.md`](../2026-11-12-daily-core-drafts-plan.md). Rules: [`README.md`](README.md).

**Owns:** `apps/web/lib/cmo/posting-plan.ts`, `lib/cmo/jobs/plan-week.ts`, `lib/cmo/jobs/draft-post.ts`,
`lib/cmo/schedule.ts`, `lib/cmo/platforms.ts`, `packages/contracts/platforms.json`, `components/today/CalendarView.tsx`,
`components/today/PostingPlanPanel.tsx`, `app/api/v1/cmo/posting-plan/`, `lib/screens/load.ts`, `lib/screens/common.ts`,
`lib/departments/publish/types.ts`, `lib/departments/publish/accounts*.ts`, `components/screens/settings/AccountsPanel.tsx`,
`lib/cmo/jobs/studio-orders.ts`, `lib/departments/studio/slideshow/build.ts`, the SQL functions `save_posting_plan`,
`post_targets`, `schedule_propose`, `platform_profile`, `platform_profile_id`, `slot_platform_of`, the platform checks,
`work_orders_plan_week`; `CLAUDE.md`, `docs/architecture/ai-cmo.md` (+ `.html`).

- [x] Task 1: posting plan (`fda79fce`)
- [x] Task 2: planner screen and week plan
- [x] Task 3: core post + fan-out + Rules-and-docs block
- [ ] Task 5: Facebook Page (with ruling 1)
- [ ] Task 8: remove `build_slideshow`

Screenshots: `shots-A/`.

## Notes for B and the owner (Task 3)

- **`cmo_save_draft` used to drop `targets`.** It replaced the item's body, so a drafted post lost the planner's targets
  and went out on one platform. `20270120020000_post_targets` keeps `targets` and `slot` (and a draft cannot set them).
- **X threads stay at 280 a post** (`THREAD_POST_CHARS`, SQL `thread_valid`), although X's profile now takes 25,000.
- **Not done in Task 3, for B's card work:** the post card still reads the profile of the item's first target
  (`lib/screens/cards.ts`), so a core post whose first target is Threads shows Threads' 500 limit; and the card clips
  each version at 3,000 characters, under X's new 25,000. The `p6-acceptance.e2e.ts` step ("one cron day, one card,
  three schedule cards") is not written; `300_post_targets` covers the fan-out in SQL.
