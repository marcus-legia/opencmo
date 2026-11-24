-- Fixes from the demanding-founder production test (2026-11-23, owner plan 2026-11-24).
--
-- 1. `work_order_for_run`: a run the week plan did not order (Scan now, the chat) made an order with a budget of 0,
--    so every such scan ended with "Over budget: “Scan Reddit” used 5 of 0 credits" and an order that "waits on you".
--    The order's budget is now the job's price, and a scan is called "Find people asking" (it reads four platforms).
--    Open orders made that way get the same budget and name.
-- 2. `cmo_save_reach`: the DM gate needed five checks at once and blocked the right people. A DM now needs the author
--    not to sell to the founder's customers, a place that allows DMs, and a post under 14 days old; an email needs
--    that and an address the person published. Same rule as `reachLevel` in apps/web/lib/cmo/reach.ts.

begin;

create or replace function public.work_order_for_run(p_run public.cmo_runs) RETURNS public.work_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_row public.work_orders;
  v_root public.work_orders;
  v_source text := p_run.input->>'source';
begin
  select * into v_row from public.work_orders where run_id = p_run.id limit 1;
  if found or p_run.kind in ('onboard', 'plan_week') then
    return v_row;
  end if;
  if coalesce(p_run.input->>'order_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    update public.work_orders set run_id = p_run.id, updated_at = now()
    where id = (p_run.input->>'order_id')::uuid and user_id = p_run.user_id and kind = p_run.kind
      and run_id is null and status in ('queued', 'deferred')
    returning * into v_row;
    if found then
      return v_row;
    end if;
  end if;
  select * into v_root from public.work_orders
  where user_id = p_run.user_id and parent_id is null and week = date_trunc('week', current_date)::date;
  if not found then
    return null;
  end if;
  select * into v_row from public.work_orders
  where root_id = v_root.id and kind = p_run.kind and run_id is null and status in ('queued', 'deferred')
  order by due_at nulls last, created_at
  limit 1
  for update skip locked;
  if not found then
    v_row := public.work_order_create(p_run.user_id, v_root.week, v_root.id, p_run.kind,
      case p_run.kind
        when 'post_draft' then 'Draft a post' when 'sales_scan' then coalesce(p_run.input->>'brief', 'Find people asking')
        when 'competitor_research' then 'Competitor research' when 'niche_video_research' then 'What works on video in your niche' when 'pull_metrics' then 'Pull post metrics'
        when 'summarize_memory' then 'Weekly memory' when 'review_week' then 'Sunday review' else p_run.kind end,
      jsonb_build_object('objective', coalesce(p_run.input->>'brief', p_run.kind)), coalesce(public.cmo_job_price(p_run.kind), 0), null, '{}',
      case when v_source in ('chat', 'mcp') then v_source when v_source = 'schedule' then 'loop' else 'founder' end);
  end if;
  update public.work_orders set run_id = p_run.id, updated_at = now() where id = v_row.id returning * into v_row;
  return v_row;
end;
$_$;

create or replace function public.cmo_save_reach(p_user uuid, p_run uuid, p_items jsonb)
returns integer
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_item jsonb;
  v_r jsonb;
  v_opp public.opportunities;
  v_dm boolean;
  v_email text;
  v_level text;
  v_reach jsonb;
  v_text text;
  v_today integer;
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.cmo_runs r where r.id = p_run and r.user_id = p_user and r.kind in ('sales_scan', 'sales_reply_drafts')
  ) then
    raise exception 'Run not found.' using errcode = 'P0002';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'These reach checks are not valid.' using errcode = '22023';
  end if;
  select count(*)::integer into v_today from public.opportunities o
  where o.user_id = p_user and o.dm_drafted_at > now() - interval '1 day';

  for v_item in select * from jsonb_array_elements(p_items) loop
    continue when jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'reach') <> 'object';
    select * into v_opp from public.opportunities o where o.user_id = p_user and o.url = v_item->>'url';
    continue when not found;
    v_r := v_item->'reach';
    v_email := nullif(btrim(coalesce(v_r->>'emailFound', '')), '');
    if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      v_email := null;
    end if;
    v_reach := jsonb_build_object(
      'buyer', coalesce(v_r->'buyer' = 'true'::jsonb, false),
      'wantsNow', coalesce(v_r->'wantsNow' = 'true'::jsonb, false),
      'warm', coalesce(v_r->'warm' = 'true'::jsonb, false),
      'fresh', coalesce(v_r->'fresh' = 'true'::jsonb, false),
      'dmAllowed', coalesce(v_r->'dmAllowed' = 'true'::jsonb, false) and v_opp.platform <> 'hn',
      'asksForTools', coalesce(v_r->'asksForTools' = 'true'::jsonb, false),
      'emailFound', v_email,
      'reasons', coalesce((
        select jsonb_agg(left(btrim(x), 160)) from (
          select x from jsonb_array_elements_text(case when jsonb_typeof(v_r->'reasons') = 'array' then v_r->'reasons' else '[]'::jsonb end) x
          where btrim(x) <> '' limit 8
        ) s), '[]'::jsonb));
    -- Same rule as `reachLevel` (lib/cmo/reach.ts): not a seller, DMs allowed, recent. The rest only orders.
    v_dm := (v_reach->>'buyer')::boolean and (v_reach->>'fresh')::boolean and (v_reach->>'dmAllowed')::boolean;
    v_level := case when not v_dm then 'reply_first' when v_email is not null then 'email_ready' else 'dm_ready' end;
    v_text := left(nullif(btrim(coalesce(v_item->>'dm', '')), ''), 1000);
    if v_text is not null and (not v_dm or v_today >= 20 or v_opp.dm_draft is not null) then
      v_text := null;
    end if;
    update public.opportunities o set
      reach = v_reach,
      reach_level = v_level,
      dm_draft = coalesce(v_text, o.dm_draft),
      dm_drafted_at = case when v_text is not null then now() else o.dm_drafted_at end
    where o.id = v_opp.id;
    if v_text is not null then
      v_today := v_today + 1;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.cmo_save_reach(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cmo_save_reach(uuid, uuid, jsonb) to service_role;

update public.work_orders o set
  budget_credits = greatest(o.budget_credits, coalesce(public.cmo_job_price(o.kind), 0)),
  title = case when o.kind = 'sales_scan' and o.title = 'Scan Reddit' then 'Find people asking' else o.title end,
  updated_at = now()
where o.parent_id is not null and o.item_id is null and o.budget_credits = 0 and public.cmo_job_price(o.kind) > 0
  and o.status not in ('done', 'failed', 'cancelled');

-- Open cards saved under the old gate: fresh is now 14 days, then the same rule from the checks they hold. No DM is
-- drafted here; the card says none is drafted yet, and the next scan or "Write the replies" drafts one.
update public.opportunities o set reach = jsonb_set(o.reach, '{fresh}',
    to_jsonb(o.posted_at is not null and o.posted_at <= now() and o.posted_at > now() - interval '14 days'))
where o.reach is not null and o.status = 'in_review';
update public.opportunities o set reach_level = case
    when not (coalesce((o.reach->>'buyer')::boolean, false) and coalesce((o.reach->>'fresh')::boolean, false)
              and coalesce((o.reach->>'dmAllowed')::boolean, false)) then 'reply_first'
    when nullif(o.reach->>'emailFound', '') is not null then 'email_ready'
    else 'dm_ready' end
where o.reach is not null and o.status = 'in_review';

commit;
