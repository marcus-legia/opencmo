# Session A: platform profiles, voice SQL, plan and event rules, loaders

Plan: [`../2026-10-28-p3-writer-plan.md`](../2026-10-28-p3-writer-plan.md) · rules: [`README.md`](README.md).

## You own

- `packages/contracts/platforms.json`, `platforms.schema.json` and their check
- `supabase/migrations/20261229*`, `supabase/tests/` for them, `supabase/schema/current.sql`
- `packages/contracts/capabilities.json` (the new Writer entries)
- `apps/web/lib/cmo/jobs/plan-week.ts`, the runner dispatch for the new order kinds, event rules
- `apps/web/lib/screens/` (types, fixtures, loaders, registry), `apps/web/app/api/v1/screens/`
- `docs/plans/cmo/2026-10-28-p3-acceptance/`

## Order

A0 → (push, M1) → A1 → A2 (after B0) → A3 → A4. Post "M1/M2/M3 ready for review" on the PR.

## Todo

- [x] **A0 Contracts (push first)** — built by Session C at the owner's request (2026-10-29: no Session A was
      running and C starts on A0's types). What A0 settled beyond the list: `platform_profile(id)` in SQL (compared
      with `platforms.json` by `lib/cmo/platforms.check.ts`), `label` and `platform` fields per profile,
      `content_items.clip_id` (a caption is a `video` content item for one edit), caption and correction fields on the
      card types (`CaptionSnapshotSchema`, `CaptionSchema`, `CAPTION_ACTION`, `editMode`/`times`), `SAMPLE_CARDS`.
  - [x] 1. `platforms.json` + schema: per profile `id`, `limit`, `visibleBeforeMore`, `tone`, `hashtags` (max, 0 for
        posts), `links` (false), `kind` (`post` | `caption` | `youtube`); X, Threads, LinkedIn, Instagram caption,
        TikTok caption, YouTube title/description, with headroom (`writer.md` §7). `check:contracts` validates it; a
        Python loader test reads the same file.
  - [x] 2. Migration skeleton: `cmo_draft_outcomes.platform`; voice notes as `cmo_memories` rows (`topic` `post`,
        `kind` `preference`, `source` = outcome id) with an index for "newest first"; `deliverables` link from a
        `caption` to its `video`/`short` (`parent_id`); pgTAP.
  - [x] 3. Screen types: `writer.voice`, `library.voice` (note, from what, when, weight), `library.skills` (name,
        what it is for, read by which agent); card snapshot types for Threads/LinkedIn posts, captions, correction.
- [x] **A1 Voice notes and corrections in SQL**: `voice_note_add(outcome_id)` (security definer, owner check),
      `voice_note_delete(id)` for the founder, weight by age in the read RPC, `expires_at` 60 days; correction trigger:
      the same edit mode 3 times in 14 days raises one `correction` card (no duplicates while one waits). pgTAP per
      path.
- [x] **A2 Plan and rules**: `plan_week` may plan Threads and LinkedIn items (strategy and goals decide; caps per
      platform); order kinds `write_caption`, `write_video_brief`, `write_slides` in `capabilities.json`; event rules:
      a video order calls `write_video_brief` before `buildVideo`; finished video and shorts batch built →
      `write_caption` per platform the plan targets.
- [x] **A3 Loaders**: per-platform drafts in `writer.drafts`, `writer.voice`, `library.voice`, `library.skills`; flip
      `live`; release gating keeps working.
- [ ] **A4 Acceptance** on a local stack with fake providers: plan → X + Threads + LinkedIn drafts → approve one, edit
      one (voice note appears), skip one → finished video → captions per platform on the shorts card. Screenshots
      at 1440 and 390 into `docs/plans/cmo/2026-10-28-p3-acceptance/`.

## Requests

(Others append `[from → A] what, why`; answer here with the commit.)

- [from B → A] Add `NODE_OPTIONS=--conditions=react-server tsx lib/cmo/writer/writer.check.ts` to `check:contracts` in
  `apps/web/package.json` (your block). It covers Writer's contract: Studio takes Writer's `VideoBrief`, every kind
  names its profile kind, the brief's new `cta` reaches the Director. Later B tasks add their asserts to the same file.
  - **Done** in the A1 commit (listed after `platforms.check.ts`; it runs green).
- [from B → A] `cmo_save_draft` inserts `platform = 'x'` when there is no item, so a CMO "now" brief can only become an
  X post; for "write this for LinkedIn now", it needs a `p_platform` (checked with `platform_profile`). B2 drafts the
  item's profile and falls back to X without one. Not blocking; only if A2 or the CMO chat should order posts per
  platform without an item.
  - **A2** takes it (with the plan's Threads and LinkedIn items). **Done** in the A2 commit:
    `cmo_save_draft(..., p_platform)`: a post profile's label ("LinkedIn"), X without one.

- [from C → A] **Captions on the Studio cards (C0 is built on fixtures; C3 needs the SQL).** A0's types already carry
  them: `FinishedVideoSnapshotSchema.captions` / `ShortsBatchSnapshotSchema.captions` (`CaptionSnapshotSchema`:
  `caption_id`, `clip_id`, `profile` = profile id, `text` = the words as they go out, hashtags included, `title` =
  YouTube's or null) and the action name `CAPTION_ACTION = "edit_caption"` (`lib/screens/approval-card.ts`). Needed:
  1. `approval_snapshot` for `editor_project` and `short_batch` adds `captions` (the `video` content items with
     `clip_id` = the edit or one of the batch's shorts, not skipped/failed, profile order of `platforms.json`), **only
     when there are some** so cards raised before keep their hash. (Session C's dropped A1 draft did this with a
     `caption_snapshot(uuid[])` helper: `git show 89577b8 -- supabase/migrations/` if useful.)
  2. A caption written or changed while its card waits refreshes that card **in place** (same id, new snapshot and
     hash), not a new card: the founder may be editing it.
  3. `approval_decide(id, 'edit_caption', {content_hash, caption, text, title?})` for `finished_video` and
     `shorts_batch`: the hash check as for every decision; the caption belongs to this card's edit(s); `text` within
     the profile's limit and hashtag count, `title` 1–100 for YouTube only; updates the caption, refreshes the card in
     place and returns it still `waiting` (not decided: no `approval_close`, no order moves).
  4. `POST /api/v1/approvals/[id]` accepts `action: "edit_caption"` with `caption` (uuid), `text` (≤ 5,000) and
     `title` (≤ 100), and answers the card **signed** (`signStudioCards`) so the previews stay. `components/cards/decide.ts`
     `editCaption()` already sends exactly this body.
  5. Approving the card makes each caption a `caption` deliverable under its video or short (`parent_id`).
  C3's e2e edits a caption on a live shorts card and expects a stale hash refused.
  - **Done.** 1–3 in A2 (`7487e37`): `caption_snapshots`, `approval_refresh` (in place), `approval_decide`
    `edit_caption` (pgTAP 212). 4: the route takes the fields in A2 and answers an `edit_caption` signed in the A3
    follow-up commit.

## A1: what B and C build on (session A, 2026-10-29)

- **Labels.** The calendar keeps writing labels ("X", "Threads", "LinkedIn", "Reels", "Shorts"), as every row before
  P3 does. Resolve them with `profileIdOf(label)` (`lib/cmo/platforms.ts`; SQL `platform_profile_id`, compared by
  check:contracts): `profileOf("X")` is null. A0 missed this twice, both fixed in A1: outcomes had no platform (SQL
  trigger + backfill), and the post card builder hid every post planned as "X" (`cards.ts`, now in screens.check).
- **Deciding a post** (`cmo_decide_post`, also under `approval_decide`): the post's own profile (unknown label → X):
  its limit ("Posts on LinkedIn can be at most 3,000 characters."), its own cap of 5 approvals a day ("You can
  approve 5 posts for Threads a day. Try again tomorrow.", a 429 in `lib/api/errors.ts`), the operation log under the
  profile id, the outcome's `platform` set.
- **Voice notes** are written by SQL, whoever decides: an approval as written at once, an edit when the classifier
  names it (`cmo_set_edit_mode`), a skip with a reason. The note is the founder's own words ("Approved as written on
  LinkedIn: \"…\"", "Edited on X before approving (cut it shorter): \"…\"", "Skipped a draft on X about \"…\": …"):
  nothing a model or outside text wrote. `cmo_memories` row: type `agent`, kind `preference`, topic `post`,
  importance 1, `source_outcome`, expires after 60 days; at most 60 per founder.
  - **B3:** `classify-edits` needs no call: labeling the edit writes the note. `voice_note_add(outcome_id)` exists
    (owner or service role, idempotent) if you want it anyway. Read with `voice_notes_for(p_user, p_limit, p_platform)`
    (service role): `id, body, platform (profile id), source ('approved' | 'edited' | 'skipped'), edit_mode,
    created_at, expires_at, weight` newest first; `weight` falls from 1 to 0 over the note's life.
  - **C1 / A3:** the founder reads `voice_notes(p_limit, p_platform)` and deletes with `voice_note_delete(id)`
    (a deleted note is never written again). A3's loader maps these into `library.voice` and `writer.voice`.
- **Corrections:** the third edit of one kind (TOO_SALESY, WRONG_VOICE, INVENTED_CLAIM, TOO_LONG, HOOK_REWRITTEN,
  CTA_REMOVED) in 14 days proposes one rule (`cmo_corrections.edit_mode`, `times`), whose card snapshot carries
  `edit_mode` and `times` (C's `editMode`, `times`); none while one waits, none while the same rule is active,
  counting starts again after each proposal. Decided through `approval_decide` as before.

## A2: Writer's orders (session A, 2026-10-29)

- **Plan:** posts go to X, Threads or LinkedIn (`toPlanItems` keeps the platform the strategy, rhythm, goal or brief
  names: one per platform a day, at most 7 X, 5 Threads, 3 LinkedIn a week). The schedule drafts every post due
  today, one `post_draft` run per item (up to 3), since `cmo_enqueue` now waits per item for a post with one.
- **Kinds:** `write_video_brief`, `write_caption`, `write_slides` are CMO run kinds (1 credit each, in
  `capabilities.json`, department `writer`). `cmo_enqueue` gives each Writer order its own run (`input.order_id`).
  SQL starts the runs; until B4 adds the jobs, a run fails as an unknown task (refunded) and its order fails cleanly.
- **Video brief (F7):** a video item of the plan → a `write_video_brief` order and a `build_video` order that waits on
  it (`depends_on`; Studio does not claim it before). Run input: `{order_id, idea, reason, seconds, aspect,
  platform}`. The job returns `output.brief` (Writer's `VideoBrief`); SQL copies objective, angle, hooks,
  `keyPoints` (as `key_points`), cta, seconds, aspect into the video order, and `briefOf` passes them to the
  Director. A brief that fails, is cancelled or returns no brief: the video goes on with the plan's own brief.
- **Captions (F8):** a finished-video card or a shorts batch card raised → one `write_caption` order. Run input:
  `{order_id, clip_ids, profiles, ref_kind, ref_id}`, where `profiles` are the caption profile ids the week's plan
  targets (`instagram_caption`, `tiktok_caption`, `youtube`; all three when its video items name none). Writer saves
  each with `cmo_save_caption(p_user, p_run, p_clip, p_profile, p_text, p_title, p_gen)` (service role; the profile's
  length, a title only on YouTube, no links, at most the profile's hashtags, counted as `countHashtags` does). A
  caption is a `content_items` row (department `video`, `platform` = profile id, `clip_id`, `body.text`/`title`/
  `drafted_text`); the card refreshes in place (same id, new hash) and its snapshot gains `captions`
  (`CaptionSnapshotSchema`). The founder edits one on the card: `POST /api/v1/approvals/[id]` with `{action:
  "edit_caption", contentHash, caption, text, title?}` (same rules; a stale hash is refused; the card keeps its id).
  Writer never overwrites a caption the founder edited. Approving the video or the batch makes each caption a
  `caption` deliverable under its video's or short's (`parent_id`), and the caption `approved`.
- **write_slides (F9):** registered; nothing orders it until S3 (P5).

## A3: loaders (session A, 2026-10-29)

- `writer.drafts`: posts on their own platform (labels resolved with `profileIdOf`), captions per platform (kind
  `caption`, the card that shows them: the finished-video card, else the shorts batch card), and the briefs Writer
  wrote for Studio (kind `video_brief`, "Fed the Studio team" once done), last two weeks. `writer.voice`: the rules
  the founder approved, the 8 heaviest voice notes (source, platform, weight), the product rule, and the strategy's
  words to avoid. Both live and in `release`.
- `library.voice`: up to 40 live voice notes (`voice_notes`) with where each came from ("Approved as written", "From
  your edit: shorter", "From a skip reason"), its platform and weight; delete with `voice_note_delete`.
  `library.skills`: read only, brain.md §8b: writing = No AI Slop and the platform profiles; video = the style skills
  we ship and the founder's own (`editor_skills`). Both live and in `release`.
- `lib/screens/load.check.ts` (in check:contracts) runs both loaders on rows shaped as the database's, through a stub
  that applies the loaders' filters; every column and RPC was also read under a founder's session on a local
  database (grants and RLS hold).

## A4: acceptance (session A, 2026-10-29) — script ready, not yet run

- `apps/web/lib/screens/p3-acceptance.e2e.ts` runs the whole of F10 on a local stack with fake providers: the plan's X,
  Threads and LinkedIn posts and a video waiting on its brief → Writer's brief taken by the video → three post cards,
  each within its profile → approve X as written, edit LinkedIn, skip Threads → three voice notes in Library and
  Writer → cards 1–3, captions on card 3 (one edited there, same card, a stale hash refused) → the shorts batch card
  with captions → captions delivered under the video and each short. Screenshots at 1440 and 390 come from
  `npm run test:e2e:writer` on the same stack (Session C's live specs).
- **Not run yet, one blocker:** Session A's container cannot start the stack (its network policy blocks the PostgREST
  and Kong images from public.ecr.aws, ghcr.io and Docker Hub). B4 (`0f16a48`) is in and matches A2's run contract
  (inputs, `{ brief, reason }`, `cmo_save_caption`). Asked Session C, whose environment runs the stack, to run it
  (C.md); then tick A4 and post M3.
- On `c120517` (A0–A4 script, B1–B4, C0–C3), locally: the full pgTAP suite (123 files), check:contracts and typecheck
  pass. CI on `96352fa` is green.
- [from B → A] FYI, at the owner's request (code review of the branch, 2026-10-29): B edited your P3 migrations in
  place (the PR is open) and regenerated `supabase/schema/current.sql`; reset your local database. `cmo_enqueue` keys a
  post's runs by item first; `work_orders_plan_week` lets a new video item take over its video order before cancelling
  leftovers, and fails and refunds a dropped brief's queued run; `cmo_save_caption` never delivers and never rewrites
  a caption that is no longer in review; `approvals_caption_rules` orders captions per cut (`document_hash`);
  `cmo_mark_posted` takes Threads and LinkedIn links and logs the post's profile; a skip reason is one voice note
  (feedback only when no note was written). pgTAP 213 covers them; 112 and 211 updated; all 124 files pass locally.
