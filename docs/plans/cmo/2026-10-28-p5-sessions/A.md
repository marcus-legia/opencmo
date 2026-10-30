# Session A: Sales safety, niche research, loaders

Plan: [`../2026-10-28-p5-research-sales-slides-plan.md`](../2026-10-28-p5-research-sales-slides-plan.md) · rules: [`README.md`](README.md).

## You own

- `supabase/migrations/20261231*`, `supabase/tests/` for them, `supabase/schema/current.sql`
- `packages/contracts/capabilities.json` (new entries), the `render_stills` row in `task-kinds.json`
- `apps/web/lib/cmo/jobs/sales-scan.ts`, `competitor-research.ts`, new `niche-video-research.ts`, `apps/web/lib/cmo/social/`
- `apps/web/lib/screens/` (types, fixtures, loaders, registry), `apps/web/app/api/v1/screens/`
- `docs/research/growth/` (the R0 report, in Vietnamese per `docs/research/README.md`), `docs/plans/cmo/2026-10-28-p5-acceptance/`

## Order

A0 → (push, M1) → A2 → A1 (once R0 names the rules source) → A3 (after B3) → A4. Post "M1/M2/M3 ready for review" on the PR.

## Todo

- [x] **A0 Contracts (push first)**
  - [x] 1. Migration skeleton with grants, RLS and pgTAP: `subreddit_rules` (subreddit, verdict
        `mention_ok|help_only|skip`, summary, read_at; shared cache, written only by the service role),
        `sales_settings` (user, excluded subreddits, co-occurrence pairs), `cmo_draft_outcomes.mentioned_product`,
        `cmo_insights.kind` gains `niche_video`, `clips.kind` gains `slideshow`, `deliverables.kind` gains `image`,
        `tasks.kind` gains `render_stills` (plus its `task-kinds.json` row). `approvals.kind` already has `slideshow`
        and Studio cards use `ref_kind = 'studio_step'`: no change there.
  - [x] 2. Snapshot types: `slideshow` (slides with text and still, MP4 preview, PNG set), Sales card states
        (help only + why, skipped + why); screen types for `sales.mentions`, `sales.stuck`, Research niche.
- [ ] **A2 Niche video research (R2)**: `niche_video_research` job: the strategy's topics → top shorts on TikTok and
      YouTube Shorts (outliers vs median; Reels only if R0 finds an Instagram search), transcripts for the top few,
      hooks with their URL; store text, metrics and URL only, never the video; budget per run; an insight without a
      URL is dropped; runs when the plan has a video item; Writer's brief reads it.
- [ ] **A1 Sales safety (R1)**: a new reader call for subreddit rules (none exists; source per R0) → classify the rules
      page as data → cache 7 days; `mentioned_product` set in code from the final approved text in
      `cmo_decide_opportunity` (last 10 approved replies, 1-in-10 rule → help only); excluded subreddits and
      co-occurrence applied before scoring; reply checks in code (no links, < 120 words); voice notes in Sales drafts
      (No AI Slop is already loaded). Tests: a hostile rules page; a help-only draft edited to name the product counts.
- [ ] **A3 Loaders, rules and publish**: `sales.mentions`, `sales.stuck`, Research niche, Studio slideshows and images;
      event rule: slideshow or image approved → schedule (P4); the P4 publish step handles `slideshow` (MP4 via its
      clip) and `image` (attached to its post), with pgTAP; flip `live`.
- [ ] **A4 Acceptance** with fake providers (F13), one real slideshow made in the Slides view kept as landing material, peak RSS of the slideshow render and stills, screenshots at 1440 and
      390 into `docs/plans/cmo/2026-10-28-p5-acceptance/`; the R0 report with the owner's decision.

## Requests

(Others append `[from → A] what, why`; answer here with the commit.)

- [from B → A] Bucket `exports` allows only `video/*`: add `image/png` and `application/zip`, or `render_stills` uploads are refused.
- [from B → A] An RPC to queue `render_stills`, like `request_document_export` (ownership, daily limit, sets the destination), e.g. `request_stills_export`. Input and output: `RenderStillsInput`, `RenderStillsOutput` in `apps/web/lib/departments/studio/types.ts`.
- [from B → A] Order kinds `build_slideshow` and `build_post_image` and their branch in `lib/cmo/jobs/studio-orders.ts`; B writes the adapter functions (B3, B4).
- [from B → A] `capabilities.json` rows for `build_slideshow` and `build_post_image` (callers `brain`, effect `write`, approval `founder`, credits 0): the squads spend no credits. Needed when B3 adds them to `STUDIO_ACCESS`.
  → [A] Done in A0 (commit below): bucket mimes, `request_stills_export(clip, revision, request)` (payload matches
  `RenderStillsInput`, plus `still_prefix` = `<user>/<clip>/<task>` for `-01.png`…), and the order kinds
  `build_slideshow` / `build_post_image` in SQL (claimed, moved, charged and departed like `build_video`). The
  `studio-orders.ts` branch and the two `capabilities.json` rows go in **B's** B3/B4 commits, with the adapter
  functions and `STUDIO_ACCESS` they must match (A agrees to B editing those two places for this).

- [A, A0] Done in `20261231090000_p5_contracts.sql` (pgTAP `221`), beyond the list above, for B and C:
  `create_slideshow(name, aspect)` (a `clips.kind = 'slideshow'` edit, renamable like a blank one);
  `studio_steps.kind` `slideshow` and its card snapshot (`SlideshowSnapshotSchema`; the hash follows the document);
  `opportunities.rule` / `rule_why` (a `skip` thread has no draft and no card); `sales_settings_save(excluded, pairs)`;
  `request_stills_export(clip, revision, request)` queuing `render_stills` with `<user>/<clip>/<task>.zip` and
  `still_prefix` for `<task>-01.png`…; bucket `exports` takes `image/png` and `application/zip`; order kinds
  `build_slideshow` and `build_post_image` claimed, moved and charged like `build_video` (Studio), and
  `niche_video_research` (Research). `render_stills` has a stub handler that fails the task until B2 replaces it.
  The `capabilities.json` rows for `buildSlideshow` / `buildPostImage` and the `studio-orders.ts` branch land with
  B's adapter functions (B0/B3), since both must change with `STUDIO_ACCESS`.

