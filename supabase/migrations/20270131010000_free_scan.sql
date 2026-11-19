-- Free scan (docs/plans/cmo/2026-11-18-free-scan-plan.md, A2): a new founder sees the people asking before paying.
--
-- 1. The first `sales_scan` of an unpaid account is free, like the first `plan_week` / `post_draft` (20270114020000).
--    It is free only once the founder's product document exists: the scan searches from it, and an account with no
--    documents could otherwise spend a scan's provider budget (Reddit, ScrapeCreators) for nothing. The worker reads
--    the run's price (0) and the account's plan, and a free scan writes no reply drafts (`sales-scan.ts`).
-- 2. `sales_reply_drafts`: after paying, one job writes the replies of the cards a free scan saved without one.
--    1 credit, 5 a day; an unpaid account gets `cmo_enqueue`'s 402 like any other priced run.
--
-- Redeclares `cmo_first_run_free` of 20270114020000 and `cmo_job_price` / `cmo_job_daily_limit` of 20270121030000;
-- only the lines named above change.

create or replace function public.cmo_first_run_free(p_user uuid, p_kind text) returns boolean
  language sql stable security definer
  set search_path to ''
as $$
  select p_user is not null
    and p_kind in ('plan_week', 'post_draft', 'sales_scan')
    and not public.cmo_paid(p_user)
    -- The free scan searches from the documents onboarding writes: none yet, no free scan.
    and (p_kind <> 'sales_scan' or exists (
      select 1 from public.marketing_documents d where d.user_id = p_user and d.kind = 'product'
    ))
    and not exists (
      select 1 from public.cmo_runs r
      where r.user_id = p_user and r.kind = p_kind and r.status in ('queued', 'running', 'done')
    )
    -- A failed run gives the free run back, at most twice: runs made to fail cannot become free work every day.
    and (select count(*) from public.cmo_runs r where r.user_id = p_user and r.kind = p_kind and r.status = 'failed') < 3;
$$;

revoke all on function public.cmo_first_run_free(uuid, text) from public, anon, authenticated;
grant execute on function public.cmo_first_run_free(uuid, text) to service_role;

alter table public.cmo_runs drop constraint if exists cmo_runs_kind_check;
alter table public.cmo_runs add constraint cmo_runs_kind_check check (kind = any (array['onboard', 'plan_week', 'post_draft',
  'sales_scan', 'competitor_research', 'pull_metrics', 'summarize_memory', 'review_week', 'write_caption', 'write_video_brief',
  'write_slides', 'publish_post', 'niche_video_research', 'distill_ratings', 'repurpose_post', 'photo_caption',
  'sales_reply_drafts']));

create or replace function public.cmo_job_price(p_kind text) returns integer
  language sql immutable
  set search_path to ''
as $$
  select case p_kind when 'plan_week' then 1 when 'post_draft' then 1 when 'sales_scan' then 5
    when 'competitor_research' then 2 when 'pull_metrics' then 0 when 'summarize_memory' then 0 when 'review_week' then 0
    when 'write_caption' then 1 when 'write_video_brief' then 1 when 'publish_post' then 0 when 'niche_video_research' then 2
    when 'repurpose_post' then 1
    when 'photo_caption' then 1
    when 'sales_reply_drafts' then 1
    else 0 end
$$;

create or replace function public.cmo_job_daily_limit(p_kind text) returns integer
  language sql immutable
  set search_path to ''
as $$
  select case p_kind when 'plan_week' then 5 when 'post_draft' then 10 when 'sales_scan' then 3
    when 'competitor_research' then 2 when 'pull_metrics' then 2 when 'summarize_memory' then 1 when 'review_week' then 1
    when 'write_caption' then 20 when 'write_video_brief' then 25 when 'publish_post' then 100 when 'niche_video_research' then 2
    -- cmo-review-3 2.2: one rating round a day (`cmo_rate_drafts`), with room for a retry.
    when 'distill_ratings' then 2
    when 'repurpose_post' then 20
    when 'photo_caption' then 20
    when 'sales_reply_drafts' then 5
    else 0 end
$$;
