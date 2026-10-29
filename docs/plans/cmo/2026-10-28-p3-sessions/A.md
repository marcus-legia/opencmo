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
- [ ] **A1 Voice notes and corrections in SQL**: `voice_note_add(outcome_id)` (security definer, owner check),
      `voice_note_delete(id)` for the founder, weight by age in the read RPC, `expires_at` 60 days; correction trigger:
      the same edit mode 3 times in 14 days raises one `correction` card (no duplicates while one waits). pgTAP per
      path.
- [ ] **A2 Plan and rules**: `plan_week` may plan Threads and LinkedIn items (strategy and goals decide; caps per
      platform); order kinds `write_caption`, `write_video_brief`, `write_slides` in `capabilities.json`; event rules:
      a video order calls `write_video_brief` before `buildVideo`; finished video and shorts batch built →
      `write_caption` per platform the plan targets.
- [ ] **A3 Loaders**: per-platform drafts in `writer.drafts`, `writer.voice`, `library.voice`, `library.skills`; flip
      `live`; release gating keeps working.
- [ ] **A4 Acceptance** on a local stack with fake providers: plan → X + Threads + LinkedIn drafts → approve one, edit
      one (voice note appears), skip one → finished video → captions per platform on the shorts card. Screenshots
      at 1440 and 390 into `docs/plans/cmo/2026-10-28-p3-acceptance/`.

## Requests

(Others append `[from → A] what, why`; answer here with the commit.)

- [from B → A] Add `NODE_OPTIONS=--conditions=react-server tsx lib/cmo/writer/writer.check.ts` to `check:contracts` in
  `apps/web/package.json` (your block). It covers Writer's contract: Studio takes Writer's `VideoBrief`, every kind
  names its profile kind, the brief's new `cta` reaches the Director. Later B tasks add their asserts to the same file.
