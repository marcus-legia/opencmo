-- Remove "Write a slideshow" and the `write_slides` job (core drafts follow-ups F2, 2026-11-13). Nothing builds slides
-- from its text any more (the CMO-built slideshow went in 20270120050000, D7): a founder who asked for one paid a
-- credit for a dead end. A photo post with a caption replaces it.
--
-- 1. `cmo_job_daily_limit('write_slides')` is 0, so `cmo_enqueue` answers "Unknown task."; its price is gone.
-- 2. `write_slides` runs still queued or running fail and their hold comes back once (`cmo_refund_run`; a running run
--    the worker finishes later is refused by `complete_cmo_run`, which only moves a `running` run). Open `write_slides`
--    orders are cancelled.
-- The kind stays in `cmo_runs_kind_check` and in the work order kinds: old rows keep it. Slideshows already made still
-- open, render and post.
-- Redeclares `cmo_job_price` and `cmo_job_daily_limit` of 20270120070000.

create or replace function public.cmo_job_price(p_kind text) returns integer
language sql immutable as $$
  select case p_kind when 'plan_week' then 1 when 'post_draft' then 1 when 'sales_scan' then 5
    when 'competitor_research' then 2 when 'pull_metrics' then 0 when 'summarize_memory' then 0 when 'review_week' then 0
    when 'write_caption' then 1 when 'write_video_brief' then 1 when 'publish_post' then 0 when 'niche_video_research' then 2
    when 'repurpose_post' then 1
    when 'photo_caption' then 1
    else 0 end
$$;

create or replace function public.cmo_job_daily_limit(p_kind text) returns integer
language sql immutable as $$
  select case p_kind when 'plan_week' then 5 when 'post_draft' then 10 when 'sales_scan' then 3
    when 'competitor_research' then 2 when 'pull_metrics' then 2 when 'summarize_memory' then 1 when 'review_week' then 1
    when 'write_caption' then 20 when 'write_video_brief' then 25 when 'publish_post' then 100 when 'niche_video_research' then 2
    -- cmo-review-3 2.2: one rating round a day (`cmo_rate_drafts`), with room for a retry.
    when 'distill_ratings' then 2
    when 'repurpose_post' then 20
    when 'photo_caption' then 20
    else 0 end
$$;

-- A function rather than a bare block so pgTAP can run it on rows it made; it is idempotent (a failed run is not
-- picked again, and `credit_refund` never refunds past the hold).
create or replace function public.cmo_drop_write_slides() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  v_run public.cmo_runs;
  v_order uuid;
  v_n integer := 0;
begin
  for v_run in
    update public.cmo_runs set status = 'failed', finished_at = now(), lease_until = null,
      error = 'OpenCMO no longer writes slideshows. Your credits were refunded; a photo post with a caption replaces it.'
    where kind = 'write_slides' and status in ('queued', 'running')
    returning *
  loop
    perform public.cmo_refund_run(v_run);
    v_n := v_n + 1;
  end loop;
  for v_order in
    select id from public.work_orders
    where kind = 'write_slides' and status in ('queued', 'running', 'deferred', 'waiting_order', 'waiting_founder')
  loop
    perform public.work_order_move(v_order, 'cancelled', 'OpenCMO no longer writes slideshows');
  end loop;
  return v_n;
end;
$$;

revoke all on function public.cmo_drop_write_slides() from public, anon, authenticated;

select public.cmo_drop_write_slides();
