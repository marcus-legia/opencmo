-- CMO review 3, 3.1: the first run is free (owner, 2026-11-10). Onboarding, the four documents, the first week's plan
-- and the first set of X drafts cost a new founder nothing; the paywall moves to the first action that sends something
-- out or costs credits again (`cmo_require_paid`, 20270114010000).
--
-- The rule reads history, never the run's input: a founder can call `enqueue_cmo_run` themselves with any `source`.

-- True for an account that is not paid (no plan and no credits: the same rule as `cmo_require_paid`, so an account
-- with credits left pays as before), for `plan_week` and `post_draft`, when it has no earlier run of that kind that
-- is queued, running or done. A failed run does not count, so a first plan that failed is tried again for free; a
-- queued one does, so two requests at once make one free run, not two.
create or replace function public.cmo_first_run_free(p_user uuid, p_kind text) returns boolean
  language sql stable security definer
  set search_path to ''
as $$
  select p_user is not null
    and p_kind in ('plan_week', 'post_draft')
    and not public.cmo_paid(p_user)
    and not exists (
      select 1 from public.cmo_runs r
      where r.user_id = p_user and r.kind = p_kind and r.status in ('queued', 'running', 'done')
    );
$$;

revoke all on function public.cmo_first_run_free(uuid, text) from public, anon, authenticated;
grant execute on function public.cmo_first_run_free(uuid, text) to service_role;

-- cmo_enqueue: the free run is priced 0 (no hold, and the credit check lets it through). Any other priced run of an
-- account without a plan or credits answers `cmo_require_paid`'s 402 instead of "Not enough credits": the chat, Sales,
-- planning again and drafting again are paid work. A run priced 0 (metrics, publishing) is unchanged.
create or replace function public.cmo_enqueue(p_user uuid, p_kind text, p_input jsonb) returns public.cmo_runs
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_row public.cmo_runs;
  v_price integer := case
    when p_input->>'brain' = 'claude' and public.is_paid(p_user) then 0
    else public.cmo_job_price(p_kind)
  end;
  v_key text := case when p_kind in ('post_draft', 'write_caption', 'write_video_brief', 'write_slides', 'publish_post')
    then coalesce(p_input->>'item_id', p_input->>'order_id') end;
begin
  -- The founder's own Claude answers inbox items over MCP, which is for paid plans only: a free founder's inbox item
  -- could never be answered, and its price was charged for nothing (review R5). Their run thinks with OpenCMO
  -- instead, and is refused below when they cannot pay for it.
  if p_input->>'brain' = 'claude' and not public.is_paid(p_user) then
    p_input := p_input - 'brain';
    v_price := public.cmo_job_price(p_kind);
  end if;
  if p_kind is null or p_kind = 'onboard' or public.cmo_job_daily_limit(p_kind) <= 0 then
    raise exception 'Unknown task.' using errcode = '22023';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 4096 then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;
  -- Replays are started by inbox_submit only, for an item the founder owns.
  if p_input ? 'inbox' then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;
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
    and (case when v_key is null then (input - 'brain') = (p_input - 'brain')
              else coalesce(input->>'item_id', input->>'order_id') = v_key end)
  order by created_at desc limit 1;
  if found then
    return v_row;
  end if;

  -- Read under the lock above, so two requests at once cannot both be the free one.
  if v_price > 0 and public.cmo_first_run_free(p_user, p_kind) then
    v_price := 0;
  elsif v_price > 0 and not public.cmo_paid(p_user) then
    perform public.cmo_plan_required();
  end if;

  if (select count(*) from public.cmo_runs
      where user_id = p_user and kind = p_kind and created_at > now() - interval '1 day'
        and not (input ? 'inbox')) >= public.cmo_job_daily_limit(p_kind) then
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

-- start_cmo_run (onboarding): an account without a plan gets 2 onboarding runs ever (one more for a typo in the URL),
-- then the 402. A paid account keeps 5 a day.
create or replace function public.start_cmo_run(p_kind text, p_input jsonb) returns public.cmo_runs
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_row public.cmo_runs;
begin
  if p_kind is distinct from 'onboard' then
    raise exception 'Unknown task.' using errcode = '22023';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 4096 then
    raise exception 'This request is not valid.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':cmo_run', 1713));

  update public.cmo_runs set status = 'failed', error = 'Timed out.', finished_at = now()
  where user_id = v_user and kind = 'onboard' and status = 'running' and created_at < now() - interval '10 minutes';

  if exists(select 1 from public.cmo_runs where user_id = v_user and kind = p_kind and status = 'running') then
    raise exception 'Your marketing plan is already being built. Give it a minute.' using errcode = 'P0001';
  end if;
  if not public.cmo_paid(v_user)
     and (select count(*) from public.cmo_runs where user_id = v_user and kind = p_kind) >= public.cmo_free_onboard_runs() then
    perform public.cmo_plan_required();
  end if;
  if (select count(*) from public.cmo_runs
      where user_id = v_user and kind = p_kind and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You can rebuild your plan 5 times a day. Try again tomorrow, or edit the documents directly.' using errcode = 'P0001';
  end if;

  insert into public.cmo_runs (user_id, kind, input) values (v_user, p_kind, p_input) returning * into v_row;
  return v_row;
end;
$$;

-- One number, so the test and the copy agree.
create or replace function public.cmo_free_onboard_runs() returns integer
  language sql immutable
as $$ select 2 $$;

revoke all on function public.cmo_free_onboard_runs() from public, anon, authenticated;
