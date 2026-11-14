-- Remove the founder's Claude inbox ("mode B"): docs/plans/cmo/2026-11-14-remove-cmo-mcp-plan.md, decision D3.
--
-- The AI CMO's MCP tools are gone (session A) and the web app no longer sends `brain` or calls the inbox RPCs
-- (session B). What is left here:
--
-- 1. Runs still queued with `input.brain = 'claude'` fail, with a sentence that tells the founder to ask again. A
--    paid founder's such run holds 0 credits (the old free path), and nobody answers it any more; the web app would
--    now run it with OpenCMO's model for free. Running ones finish as they are (a lease cannot be taken back).
--    No credit is held for them: a `brain = 'claude'` run of a paid plan was priced 0, a free plan's lost the key
--    (`cmo_enqueue`), and inbox replays were inserted with `credits = 0` (`inbox_submit`). Items that waited in the
--    inbox ended their run `done` through `complete_cmo_run` (`cmo_inbox_open`), which settled it, so dropping the
--    table holds no money either. Check before the push, expected 0 rows:
--      select id, credits from public.cmo_runs where input->>'brain' = 'claude' and credits > 0
--        and status in ('queued', 'running');
-- 2. `cmo_inbox` and its six functions are dropped.
-- 3. `cmo_enqueue` strips `brain` and `inbox` from every input, so no client can reach the 0-credit branch again,
--    and that branch goes. This is the money line of the plan.
-- 4. `cmo_first_draft_after_plan` and `cmo_order_script` lose their `brain` handling (`p_brain` goes).
-- 5. `cmo_read_limit` / `cmo_read_hit` lose the MCP buckets `mcp_social` and `mcp_site`.

-- 1 -----------------------------------------------------------------------------------------------------------------

create or replace function public.cmo_fail_claude_runs() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_run public.cmo_runs;
  v_count integer := 0;
begin
  for v_run in
    select * from public.cmo_runs where status = 'queued' and input->>'brain' = 'claude' order by created_at for update skip locked
  loop
    -- Through `complete_cmo_run`, like any failed run: its refund and the triggers that fail its work order run too.
    update public.cmo_runs set status = 'running', attempt = attempt + 1, started_at = coalesce(started_at, now())
    where id = v_run.id returning * into v_run;
    perform public.complete_cmo_run(v_run.id, v_run.attempt, false, null,
      'This task was waiting for your own Claude, which OpenCMO no longer uses. Ask for it again.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.cmo_fail_claude_runs() from public, anon, authenticated;
grant execute on function public.cmo_fail_claude_runs() to service_role;

select public.cmo_fail_claude_runs();

-- 2 -----------------------------------------------------------------------------------------------------------------

drop function if exists public.inbox_submit(uuid, uuid, text, jsonb);
drop function if exists public.inbox_claim(uuid);
drop function if exists public.inbox_list();
drop function if exists public.cmo_inbox_finish(uuid, boolean, text);
drop function if exists public.cmo_inbox_open(uuid, integer, text, jsonb, jsonb);
drop function if exists public.cmo_inbox_max_rounds();
drop table if exists public.cmo_inbox;

-- 3 -----------------------------------------------------------------------------------------------------------------

create or replace function public.cmo_enqueue(p_user uuid, p_kind text, p_input jsonb) returns public.cmo_runs
language plpgsql security definer set search_path = public as $$
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

  -- Read under the lock above, so two requests at once cannot both be the free one.
  if v_price > 0 and public.cmo_first_run_free(p_user, p_kind) then
    v_price := 0;
  elsif v_price > 0 and not public.cmo_paid(p_user) then
    perform public.cmo_plan_required();
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

-- 4 -----------------------------------------------------------------------------------------------------------------

create or replace function public.cmo_first_draft_after_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'plan_week' and new.status = 'done' and old.status is distinct from 'done'
     and new.input->>'source' = 'onboarding'
     -- A plan that ended in the old Claude inbox wrote no week: nothing to draft from.
     and not (coalesce(new.output, '{}'::jsonb) ? 'waiting_for') then
    begin
      perform public.cmo_enqueue(new.user_id, 'post_draft', jsonb_build_object('source', 'onboarding'));
    exception when others then
      -- A refused draft (paused CMO, no credits, daily limit) must not undo the plan; the daily loop drafts instead.
      raise warning 'first draft not queued for %: %', new.user_id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop function if exists public.cmo_order_script(text, date, text);

create function public.cmo_order_script(p_brief text, p_day date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.require_user();
  v_item public.content_items;
  v_root public.work_orders;
  v_order public.work_orders;
  v_run public.cmo_runs;
  v_free integer;
  v_price integer := public.cmo_job_price('write_video_brief');
  v_input jsonb;
begin
  v_item := public.cmo_add_item('video', p_brief, coalesce(p_day, current_date), 'Asked in the CMO chat', '{}'::jsonb);
  v_root := public.work_order_week_root(v_user);
  v_free := v_root.budget_credits - v_root.spent_credits - coalesce((
    select sum(budget_credits - spent_credits) from public.work_orders
    where parent_id = v_root.id and status not in ('done', 'failed', 'cancelled')), 0);
  -- The founder confirmed this price on the chat's card, so it is theirs to spend, not the brain's weekly budget: when
  -- the week has less than the price left, the root grows by what is missing and the order spends exactly that. The
  -- brain gets no more room for its own work, and the order is never "over budget" for a charge the founder chose.
  if greatest(v_free, 0) < v_price then
    update public.work_orders set budget_credits = budget_credits + (v_price - greatest(v_free, 0)), updated_at = now()
    where id = v_root.id;
  end if;
  v_order := public.work_order_create(v_user, v_root.week, v_root.id, 'write_video_brief',
    left('Script for “' || v_item.idea || '”', 200),
    jsonb_build_object('objective', v_item.idea, 'reason', 'Asked in the CMO chat', 'platform', v_item.platform,
      'done_when', 'The founder approved the script.'),
    v_price, (v_item.day + interval '23 hours 59 minutes') at time zone 'UTC', '{}', 'chat',
    v_item.id);
  v_input := jsonb_build_object('idea', v_item.idea, 'reason', 'Asked in the CMO chat', 'seconds', public.cmo_video_seconds(),
    'aspect', '9:16', 'platform', v_item.platform, 'order_id', v_order.id, 'source', 'chat');
  v_run := public.cmo_enqueue(v_user, 'write_video_brief', v_input);
  return jsonb_build_object('item_id', v_item.id, 'order_id', v_order.id, 'run_id', v_run.id, 'status', v_run.status,
    'day', v_item.day, 'credits', v_run.credits);
end;
$$;

revoke all on function public.cmo_order_script(text, date) from public, anon;
grant execute on function public.cmo_order_script(text, date) to authenticated, service_role;

-- 5 -----------------------------------------------------------------------------------------------------------------

create or replace function public.cmo_read_limit(p_bucket text) returns integer
language sql immutable as $$
  select case p_bucket
    -- Review R4: the in-app CMO chat counts here (its in-memory caps start again on every continue).
    when 'chat_social' then 120 when 'chat_site' then 30
    when 'research_credits' then 30
    else 0 end
$$;

create or replace function public.cmo_read_hit(p_bucket text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.require_user();
  v_limit integer := public.cmo_read_limit(p_bucket);
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / 3600) * 3600);
  v_count integer;
begin
  if v_limit <= 0 then
    raise exception 'Invalid rate limit.' using errcode = '22023';
  end if;
  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (v_user, p_bucket, v_window, 1)
  on conflict (user_id, bucket, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  if v_count > v_limit then
    return false;
  end if;
  -- Social reads spend OpenCMO's ScrapeCreators key and cost the founder nothing: one daily ceiling on top of the
  -- hourly one.
  if p_bucket = 'chat_social' then
    insert into public.rate_limits (user_id, bucket, window_start, count)
    values (v_user, 'social_day', date_trunc('day', now()), 1)
    on conflict (user_id, bucket, window_start) do update set count = public.rate_limits.count + 1
    returning count into v_count;
    return v_count <= 400;
  end if;
  return true;
end;
$$;
