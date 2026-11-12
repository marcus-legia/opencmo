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
- [x] Task 7: repurpose on demand. **Waits on A's Task 3** (fan-out slots per target) — check `A.md`.
- [x] Task 9: photo post. **Waits on A's Task 5** (`schedule_propose` with Facebook; your migration redeclares it after A's).
- [x] Whole-branch code review once every box in `A.md` and here is ticked: run `/code-review` (high) on the PR's diff
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
- **Task 7, first half (pushed before A's Task 3):** the `repurpose_post` job, `post_variants`, `cmo_save_variant`,
  the founder's RPC `repurpose_post(item, platform)`, the route `POST /api/v1/cmo/items/[id]/repurpose` and
  `schedule_content` preferring a current variant. A variant is tied to the core text it was written from
  (`source_hash`): edit the post and the core text goes out again. **Still to do once Task 3 is in:** the Rewrite button
  per target on the post card, the variant shown on the card, and the rule that a slot carrying a variant never rides
  on the post card's approval (`schedule_take_proposal`), so no rewrite goes out unseen. No button exists until then,
  so no variant can be made.
- **Task 7, second half (done by the session that took over A's and B's remaining work, 2026-11-12):** the post card
  lists its targets and each current rewrite (`withPostTargets` in `lib/screens/schedule-enrich.ts`, read at load like
  the script caption, so `approval_snapshot` and its hash are untouched), a "Rewrite for <platform> · 1 credit" button
  per target when the post goes to two or more, and `20270120045000_variant_take`: a slot posting a rewrite never takes
  the post card's approved time, so the rewrite shows on its own schedule card (`307_variant_take`). A core post's card
  shows the core profile's limit (3,000) instead of its first target's.
- **Task 9 (done by the session that took over, 2026-11-12):** `photo_posts` + private `photos` bucket (TUS with a
  reservation), `photo_post_*` RPCs (TikTok ≤ 35, Instagram/Threads ≤ 20, connected account required), slots per
  platform, photos sent as 1-hour signed URLs (no `publish_media`), TikTok Photo Mode in a top-level `tiktokSettings`
  (docs.zernio.com, not yet tried on a real account), `photo_caption` job (1 credit). Looked at in the browser: upload
  and the panel work locally. Not done: retention cleanup of the `photos` bucket, the whole-branch review, screenshots.

## Whole-branch review (2026-11-12)

`/code-review` (high) on the diff against `main` found ten defects; all are fixed in
`20270120070000_review_fixes` (pgTAP `308_review_fixes`) and four web files, and the fixes were read again once.

| # | What was wrong | Fix |
|---|---|---|
| 1 | The first platform to post marked the core post `published`, and the hand-posted rule cancelled its other slots: a core post went out on one platform only. | The post is `published` when its last open slot is (`post_slots_open`); cancelling the rest after one posted settles it. |
| 2 | `storage_deletions` lost `captures` (the purge of unpaid accounts would fail) and the purge never queued `photos`. | Both buckets are back in the check and in the purge. |
| 3 | A core post was approved against its first platform's limit: with Threads first, nothing over 500 characters could be approved. | A post with more than one target is checked against the core limit (3,000). |
| 4 | Every "New photo post" made a draft, nothing removed one, and the sixth failed for good. | One open draft a founder; starting again empties it and hands it back. |
| 5 | A long script plus its caption broke the 4,096-byte brief; the error was swallowed and no script card came. | The brief holds 8,192 bytes (`cmo_script_edit_beat` says the same number). |
| 6 | The planner allows 21 scripts a week, ordered at plan time; only 5 a day could be queued. | `write_video_brief` takes 25 a day. |
| 7 | "Post as a thread" pressed after the slot's window lost the setting on the new slot. | A new X slot keeps `as_thread` of the slot it replaces. |
| 8 | A Threads photo post took a 2,200-character caption that Threads refuses (only a text post is chained). | Refused in words before it is scheduled: 500 characters with Threads. |
| 9 | X at 25,000 and Facebook at 5,000 were longer than an approved post is kept (4,000) and a schedule card carries. | **Both are 4,000** in `platforms.json` and SQL. Owner: say so if X should go longer; `final_text`, the draft body (16 KB), the card snapshot (32 KB) and the publish schema all have to grow with it. |
| 10 | The Rewrite button stayed "Rewriting…" after a run failed or finished. | It is free again when the card changes, or after two minutes. |

**Left for the owner or a later task**

- Photos of an emptied photo draft stay in Storage (they count toward the quota) until the account's cleanup.
- A core post with a failed slot whose card nobody decides stays `approved`; it shows as posted per platform, not as a whole.
- Not verified against Zernio (`zernio.com` is not reachable from the cloud session): `threadItems` for Threads, the words
  of X's "too long" refusal, photo carousels. Check on a real account before the owner's test.
- pgTAP ran on a local Postgres 16 shim; nine older test files cannot run there (table grants the shim lacks). CI's run is
  the authoritative one.
