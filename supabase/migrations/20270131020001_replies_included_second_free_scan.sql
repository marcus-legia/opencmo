-- Wave 2 A3 (docs/plans/cmo/2026-11-19-wave2-plan.md).
--
-- 1. Reply drafts are included work: `sales_reply_drafts` costs 0. It stays paid work: only a paid account may start
--    it (`cmo_require_paid` in `cmo_enqueue`), since a price of 0 no longer sends a free account to the plan sheet.
-- 2. A free scan that found no one may be tried once more: `cmo_first_run_free('sales_scan')` is also true when every
--    earlier non-failed free scan of the account is done with `output->>'verdict' = 'none'`, and there was only one.
--    A scan still queued or running, or one that found people, ends the free scans as before.

create or replace function public.cmo_job_price(p_kind text) returns integer
  language sql immutable
  set search_path to ''
as $$
  select case p_kind when 'plan_week' then 1 when 'post_draft' then 1 when 'sales_scan' then 5
    when 'competitor_research' then 2 when 'pull_metrics' then 0 when 'summarize_memory' then 0 when 'review_week' then 0
    when 'write_caption' then 1 when 'write_video_brief' then 1 when 'publish_post' then 0 when 'niche_video_research' then 2
    when 'repurpose_post' then 1
    when 'photo_caption' then 1
    -- Included in the plan (wave 2); `cmo_enqueue` keeps it paid-only.
    when 'sales_reply_drafts' then 0
    else 0 end
$$;

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
    and (
      not exists (
        select 1 from public.cmo_runs r
        where r.user_id = p_user and r.kind = p_kind and r.status in ('queued', 'running', 'done')
      )
      -- One more free scan after one that found no one (wave 2): the founder edits Strategy and tries again.
      or (p_kind = 'sales_scan'
        and not exists (
          select 1 from public.cmo_runs r
          where r.user_id = p_user and r.kind = 'sales_scan' and r.status in ('queued', 'running', 'done')
            -- coalesce: a done scan with no verdict (an older run) is not one that found no one.
            and not coalesce(r.status = 'done' and r.credits = 0 and r.output->>'verdict' = 'none', false)
        )
        and (select count(*) from public.cmo_runs r
             where r.user_id = p_user and r.kind = 'sales_scan' and r.status = 'done') < 2)
    )
    -- A failed run gives the free run back, at most twice: runs made to fail cannot become free work every day.
    and (select count(*) from public.cmo_runs r where r.user_id = p_user and r.kind = p_kind and r.status = 'failed') < 3;
$$;

create or replace function public.cmo_enqueue(p_user uuid, p_kind text, p_input jsonb) returns public.cmo_runs
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_row public.cmo_runs;
  v_price integer := public.cmo_job_price(p_kind);
  v_key text := case when p_kind in ('post_draft', 'write_caption', 'write_video_brief', 'write_slides', 'publish_post')
    then coalesce(p_input->>'item_id', p_input->>'order_id') end;
begin
  if p_kind is null or p_kind = 'onboard' or public.cmo_job_daily_limit(p_kind) <= 0 then
    raise exception 'Unknown task.' using errcode = '22023';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 4096 then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;
  -- The founder's Claude inbox is gone (2026-11-14): `brain` once made a paid founder's run free, and `inbox` named
  -- the item a replay answered. Neither means anything now; an old client that still sends them pays as anyone does.
  p_input := p_input - 'brain' - 'inbox';
  if public.cmo_paused(p_user) then
    raise exception 'Your CMO is paused. Resume it to start new work.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':cmo_run', 1713));

  select * into v_row from public.cmo_runs
  where user_id = p_user and kind = p_kind and status in ('queued', 'running')
    -- A running run whose lease ran out is still in flight: claim_cmo_run puts it back in the queue. Treating it as
    -- gone made a second run and a second hold, and both ran (review R5).
    -- Without an item or order, only the same request is the same run: two posts with two briefs are two runs
    -- (review R4; the second brief used to be dropped while the chat said it had started).
    and (case when v_key is null then (input - 'brain' - 'inbox') = p_input
              else coalesce(input->>'item_id', input->>'order_id') = v_key end)
  order by created_at desc limit 1;
  if found then
    return v_row;
  end if;

  -- Included in the plan but not free: reply drafts are paid work at no extra cost (wave 2).
  if p_kind = 'sales_reply_drafts' and not public.cmo_paid(p_user) then
    perform public.cmo_plan_required();
  end if;

  -- Read under the lock above, so two requests at once cannot both be the free one.
  if v_price > 0 and public.cmo_first_run_free(p_user, p_kind) then
    v_price := 0;
  elsif v_price > 0 and not public.cmo_paid(p_user) then
    perform public.cmo_plan_required();
  end if;

  -- The fair-use pause (wave 2): a used-up allowance stops new searches until the reset, not drafts of work in hand.
  if v_price > 0 then
    perform public.cmo_usage_paused_check(p_user, p_kind);
  end if;

  if (select count(*) from public.cmo_runs
      where user_id = p_user and kind = p_kind and created_at > now() - interval '1 day') >= public.cmo_job_daily_limit(p_kind) then
    raise exception 'You have reached today''s limit for this task. Try again tomorrow.' using errcode = 'P0001';
  end if;
  if v_price > 0 and public.credit_balance(p_user) < v_price then
    raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
      v_price, public.credit_balance(p_user) using errcode = 'P0001';
  end if;

  insert into public.cmo_runs (user_id, kind, status, input, credits)
  values (p_user, p_kind, 'queued', p_input, v_price) returning * into v_row;
  if v_price > 0 then
    perform public.credit_hold(p_user, 'cmo_run', v_row.id, v_price, 'CMO hold');
  end if;
  return v_row;
end;
$$;
