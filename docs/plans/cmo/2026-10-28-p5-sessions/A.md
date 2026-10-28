# Session A: Sales safety, niche research, loaders

Plan: [`../2026-10-28-p5-research-sales-slides-plan.md`](../2026-10-28-p5-research-sales-slides-plan.md) · rules: [`README.md`](README.md).

## You own

- `supabase/migrations/20261231*`, `supabase/tests/` for them, `supabase/schema/current.sql`
- `packages/contracts/capabilities.json` (new entries), the `render_stills` row in `task-kinds.json`
- `apps/web/lib/cmo/jobs/sales-scan.ts`, `competitor-research.ts`, new `niche-video-research.ts`, `apps/web/lib/cmo/social/`
- `apps/web/lib/screens/` (types, fixtures, loaders, registry), `apps/web/app/api/v1/screens/`
- `docs/research/growth/` (the R0 report, in Vietnamese per `docs/research/README.md`), `docs/plans/cmo/2026-10-28-p5-acceptance/`

## Order

A0 → (push, M1) → A1 → A2 → A3 (after B3) → A4. Post "M1/M2/M3 ready for review" on the PR.

## Todo

- [ ] **A0 Contracts (push first)**
  - [ ] 1. Migration skeleton with grants, RLS and pgTAP: `subreddit_rules` (subreddit, verdict
        `mention_ok|help_only|skip`, summary, read_at; shared cache, written only by the service role),
        `sales_settings` (user, excluded subreddits, co-occurrence pairs), `cmo_draft_outcomes.mentioned_product`,
        `cmo_insights.kind` gains `niche_video`, `clips.kind` gains `slideshow`, `deliverables.kind` gains `image`,
        `approvals.ref_kind` for a slideshow.
  - [ ] 2. Snapshot types: `slideshow` (slides with text and still, MP4 preview, PNG set), Sales card states
        (help only + why, skipped + why); screen types for `sales.mentions`, `sales.stuck`, Research niche.
- [ ] **A1 Sales safety (R1)**: rules check before drafting (reader → classify the rules page as data → cache 7 days),
      mention counter (last 10 replied, 1-in-10 rule → help only), excluded subreddits and co-occurrence applied
      before scoring; reply checks in code (no links, < 120 words); Sales drafts load No AI Slop and voice notes.
      Tests with a hostile rules page.
- [ ] **A2 Niche video research (R2)**: `niche_video_research` job: the strategy's topics → top shorts on TikTok,
      YouTube Shorts, Reels (outliers vs median), transcripts for the top few, hooks with their URL; budget per run;
      an insight without a URL is dropped; runs when the plan has a video item; Writer's brief reads it.
- [ ] **A3 Loaders and rules**: `sales.mentions`, `sales.stuck`, Research niche, Studio slideshows and images; event
      rule: slideshow or image approved → schedule (P4); flip `live`.
- [ ] **A4 Acceptance** with fake providers (F12), peak RSS of the slideshow render and stills, screenshots at 1440 and
      390 into `docs/plans/cmo/2026-10-28-p5-acceptance/`; the R0 report with the owner's decision.

## Requests

(Others append `[from → A] what, why`; answer here with the commit.)
