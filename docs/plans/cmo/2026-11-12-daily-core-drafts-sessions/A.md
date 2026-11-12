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
- [x] Task 5: Facebook Page (with ruling 1)
- [x] Task 8: remove `build_slideshow`

Screenshots: `shots-A/`.

## Notes for B and the owner (Task 3)

- **`cmo_save_draft` used to drop `targets`.** It replaced the item's body, so a drafted post lost the planner's targets
  and went out on one platform. `20270120020000_post_targets` keeps `targets` and `slot` (and a draft cannot set them).
- **X threads stay at 280 a post** (`THREAD_POST_CHARS`, SQL `thread_valid`), although X's profile now takes 25,000.
- **Not done in Task 3, for B's card work:** the post card still reads the profile of the item's first target
  (`lib/screens/cards.ts`), so a core post whose first target is Threads shows Threads' 500 limit; and the card clips
  each version at 3,000 characters, under X's new 25,000. The `p6-acceptance.e2e.ts` step ("one cron day, one card,
  three schedule cards") is not written; `300_post_targets` covers the fan-out in SQL.

## Notes (Task 5)

- Zernio (docs.zernio.com/platforms/facebook, read 2026-11-12): slug `facebook`, the founder picks the Page in the
  connect flow, a post sends only `platform` and `accountId`. "Personal profiles cannot post through the API."
- Facebook gets its own writer agent (`facebook_writer`) and default slots 09:00 and 13:00 (a placeholder: the Buffer
  study in `schedule-defaults.json` has no Facebook figure used here). Autopilot stays off for Facebook.
- A plan saved before Facebook joined reads `facebook` as 0; `save_posting_plan` now needs all four counts.

## Notes (Task 8)

- Removed: the `buildSlideshow` adapter entry and its capability, the studio runner's branch, the week plan's
  `write_slides` + `build_slideshow` orders (`20270120050000`); queued ones are cancelled and a queued slides run is
  refunded. `work_orders_brief_rules` is not redefined, so B's caption copy stays.
- Kept on purpose: slideshow edits and cards already made (`renderSlideshow`, the render route, the Studio list in
  `load.ts`, `ui-v2-slides.spec.ts`, `p5-acceptance.e2e.ts`), so a founder can still open and post them. Step 1's grep
  therefore still lists those files. The `write_slides` job and the Writer's "Write a slideshow" chip are left for the
  owner to decide (D7 says the CMO writes the caption of a photo post; Task 9's `photo_caption` does that).
