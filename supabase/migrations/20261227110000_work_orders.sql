-- 20261227110000: brain B1, work orders, deliverables and the live log (docs/architecture/brain.md §6;
-- brain plan W1-3).
--
-- The week becomes a tree: one root order per founder per week (the plan, with the weekly credit budget), one child
-- per calendar item and per weekly job. Orders do not run anything themselves: the loops keep enqueuing `cmo_runs`
-- as today, and a trigger on `cmo_runs` attaches each run to its order and moves the order with it. A run's output
-- rows (posts, Reddit threads, insights) become the order's deliverables; an order whose deliverable waits on a card
-- is `waiting_founder` until the card is decided.
--
-- Every status change goes through `work_order_move`, the one writer of status: it checks the transition, the
-- dependencies, and that `done` has a deliverable or a stated reason, and it appends the live-log line.

begin;

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The root's own id for the root; a root has no parent.
  root_id uuid references public.work_orders(id) on delete cascade,
  parent_id uuid references public.work_orders(id) on delete cascade,
  -- Monday of the week the tree belongs to.
  week date not null check (extract(isodow from week) = 1),
  depends_on uuid[] not null default '{}' check (cardinality(depends_on) <= 20),
  department text not null check (department in ('brain', 'research', 'writer', 'studio', 'sales', 'schedule', 'publish')),
  kind text not null check (kind ~ '^[a-z_]{1,40}$'),
  title text not null check (char_length(title) between 1 and 200),
  brief jsonb not null default '{}'::jsonb check (jsonb_typeof(brief) = 'object' and octet_length(brief::text) <= 4096),
  budget_credits integer not null default 0 check (budget_credits >= 0),
  spent_credits integer not null default 0 check (spent_credits >= 0),
  due_at timestamptz,
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting_founder', 'waiting_order',
    'deferred', 'done', 'failed', 'cancelled')),
  -- {code, message, retryable, repair_hint}: the replan reads it and may not retry the same brief unchanged.
  error jsonb check (error is null or (jsonb_typeof(error) = 'object' and error ? 'code' and error ? 'message'
    and octet_length(error::text) <= 2048)),
  -- Why an order is done without a deliverable ("nothing to approve this time").
  done_reason text check (char_length(done_reason) <= 200),
  run_id uuid references public.cmo_runs(id) on delete set null,
  -- The calendar item an order was planned from.
  item_id uuid references public.content_items(id) on delete set null,
  created_by text not null default 'loop' check (created_by in ('loop', 'chat', 'event', 'mcp', 'founder')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((parent_id is null) = (root_id is null or root_id = id)),
  check (spent_credits <= budget_credits)
);
create unique index work_orders_one_root on public.work_orders (user_id, week) where parent_id is null;
create index work_orders_user_idx on public.work_orders (user_id, week, status);
create index work_orders_root_idx on public.work_orders (root_id);
create index work_orders_run_idx on public.work_orders (run_id) where run_id is not null;
create index work_orders_item_idx on public.work_orders (item_id) where item_id is not null;

create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.work_orders(id) on delete cascade,
  kind text not null check (kind in ('post', 'caption', 'video', 'short', 'slideshow', 'reply', 'insight', 'metric')),
  ref_kind text not null check (ref_kind in ('content_item', 'opportunity', 'insight')),
  ref_id uuid not null,
  -- `waiting_founder` while its card waits; `decided` once approved or skipped.
  status text not null default 'ready' check (status in ('ready', 'waiting_founder', 'decided')),
  created_at timestamptz not null default now(),
  unique (ref_kind, ref_id)
);
create index deliverables_order_idx on public.deliverables (order_id);

-- Append-only: the Dashboard's live log and the Brain page's history.
create table public.work_order_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.work_orders(id) on delete cascade,
  department text not null,
  at timestamptz not null default now(),
  kind text not null check (kind in ('created', 'running', 'waiting_founder', 'waiting_order', 'deferred', 'queued',
    'done', 'failed', 'cancelled', 'note')),
  text text not null check (char_length(text) between 1 and 200)
);
create index work_order_events_user_idx on public.work_order_events (user_id, at desc);

alter table public.work_orders enable row level security;
alter table public.deliverables enable row level security;
alter table public.work_order_events enable row level security;
create policy "read own work orders" on public.work_orders for select to authenticated using (user_id = (select auth.uid()));
create policy "read own deliverables" on public.deliverables for select to authenticated using (user_id = (select auth.uid()));
create policy "read own order events" on public.work_order_events for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.work_orders, public.deliverables, public.work_order_events from anon, authenticated;
grant select on public.work_orders, public.deliverables, public.work_order_events to authenticated;
grant select, insert, update, delete on public.work_orders, public.deliverables to service_role;
revoke all on public.work_order_events from service_role;
grant select, insert on public.work_order_events to service_role;
alter publication supabase_realtime add table public.work_orders, public.deliverables, public.work_order_events;

create or replace function public.work_order_department(p_kind text) returns text
language sql immutable set search_path = public
as $$
  select case p_kind
    when 'post_draft' then 'writer' when 'sales_scan' then 'sales'
    when 'competitor_research' then 'research' when 'pull_metrics' then 'research' when 'review_week' then 'research'
    else 'brain' end
$$;

create or replace function public.work_order_event(p_order public.work_orders, p_kind text, p_text text)
returns void language sql volatile security definer set search_path = public
as $$
  insert into public.work_order_events (user_id, order_id, department, kind, text)
  values (p_order.user_id, p_order.id, p_order.department, p_kind, left(p_text, 200))
$$;

-- The one writer of status. Moves that are not in the state machine (brain.md §6) refuse; `running` waits on
-- `depends_on`; `done` needs a deliverable or `p_reason`; `failed` needs `p_error` {code, message}.
create or replace function public.work_order_move(p_id uuid, p_to text, p_text text default null,
  p_error jsonb default null, p_reason text default null)
returns public.work_orders language plpgsql volatile security definer set search_path = public
as $$
declare
  v_row public.work_orders;
  v_ok boolean;
begin
  select * into v_row from public.work_orders where id = p_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if v_row.status = p_to then
    return v_row;
  end if;
  v_ok := case v_row.status
    when 'queued' then p_to in ('running', 'deferred', 'waiting_order', 'cancelled')
    when 'running' then p_to in ('waiting_founder', 'waiting_order', 'deferred', 'queued', 'done', 'failed', 'cancelled')
    when 'waiting_founder' then p_to in ('queued', 'running', 'done', 'failed', 'cancelled')
    when 'waiting_order' then p_to in ('queued', 'running', 'done', 'failed', 'cancelled')
    when 'deferred' then p_to in ('queued', 'running', 'done', 'failed', 'cancelled')
    else false end;
  if not v_ok then
    raise exception 'An order cannot go from % to %.', v_row.status, p_to using errcode = 'P0001';
  end if;
  if p_to = 'running' and exists (
    select 1 from unnest(v_row.depends_on) d(id)
    left join public.work_orders o on o.id = d.id
    where o.status is distinct from 'done') then
    raise exception 'This order waits on another order.' using errcode = 'P0001';
  end if;
  if p_to = 'done' and nullif(trim(coalesce(p_reason, '')), '') is null
     and not exists (select 1 from public.deliverables where order_id = p_id) then
    raise exception 'An order is done only with a deliverable or a reason.' using errcode = 'P0001';
  end if;
  if p_to = 'failed' and (p_error is null or not (p_error ? 'code' and p_error ? 'message')) then
    raise exception 'A failed order needs an error code and message.' using errcode = '22023';
  end if;
  update public.work_orders
  set status = p_to,
      error = case when p_to = 'failed' then p_error when p_to in ('queued', 'running') then null else error end,
      done_reason = case when p_to = 'done' then left(nullif(trim(coalesce(p_reason, '')), ''), 200) else done_reason end,
      finished_at = case when p_to in ('done', 'failed', 'cancelled') then now() else null end,
      updated_at = now()
  where id = p_id
  returning * into v_row;
  perform public.work_order_event(v_row, p_to, coalesce(p_text, case p_to
    when 'running' then 'Started “' || v_row.title || '”'
    when 'waiting_founder' then '“' || v_row.title || '” waits on you'
    when 'waiting_order' then '“' || v_row.title || '” waits on another order'
    when 'deferred' then '“' || v_row.title || '” continues later'
    when 'queued' then '“' || v_row.title || '” is queued again'
    when 'done' then 'Finished “' || v_row.title || '”'
    when 'failed' then '“' || v_row.title || '” failed: ' || (p_error->>'message')
    else 'Cancelled “' || v_row.title || '”' end));
  return v_row;
end;
$$;

-- Creates an order under a parent (or a root when `p_parent` is null). A child's budget comes out of what its
-- parent has not handed out yet; asking for more refuses (spending beyond a budget always needs a card).
create or replace function public.work_order_create(p_user uuid, p_week date, p_parent uuid, p_kind text, p_title text,
  p_brief jsonb default '{}'::jsonb, p_budget integer default 0, p_due timestamptz default null,
  p_depends_on uuid[] default '{}', p_created_by text default 'loop', p_item uuid default null,
  p_department text default null)
returns public.work_orders language plpgsql volatile security definer set search_path = public
as $$
declare
  v_parent public.work_orders;
  v_row public.work_orders;
  v_free integer;
begin
  if p_parent is not null then
    select * into v_parent from public.work_orders where id = p_parent and user_id = p_user for update;
    if not found then
      raise exception 'Parent order not found.' using errcode = 'P0002';
    end if;
    v_free := v_parent.budget_credits - v_parent.spent_credits - coalesce((
      select sum(budget_credits - spent_credits) from public.work_orders
      where parent_id = p_parent and status not in ('done', 'failed', 'cancelled')), 0);
    if coalesce(p_budget, 0) > v_free then
      raise exception 'The parent order has % credits left to hand out.', greatest(v_free, 0) using errcode = 'P0001';
    end if;
  end if;
  if exists (select 1 from unnest(coalesce(p_depends_on, '{}')) d(id)
             where not exists (select 1 from public.work_orders o where o.id = d.id and o.user_id = p_user)) then
    raise exception 'An order can only wait on the founder''s own orders.' using errcode = '22023';
  end if;
  insert into public.work_orders (user_id, root_id, parent_id, week, depends_on, department, kind, title, brief,
    budget_credits, due_at, created_by, item_id)
  values (p_user, coalesce(v_parent.root_id, v_parent.id), p_parent, coalesce(v_parent.week, p_week),
    coalesce(p_depends_on, '{}'), coalesce(p_department, public.work_order_department(p_kind)), p_kind,
    left(coalesce(nullif(trim(p_title), ''), p_kind), 200), coalesce(p_brief, '{}'::jsonb), coalesce(p_budget, 0),
    p_due, p_created_by, p_item)
  returning * into v_row;
  if p_parent is null then
    update public.work_orders set root_id = id where id = v_row.id returning * into v_row;
  end if;
  perform public.work_order_event(v_row, 'created', 'Planned “' || v_row.title || '”');
  return v_row;
end;
$$;

-- Spends on an order and every order above it. Refuses before any of them would pass its budget.
create or replace function public.work_order_spend(p_id uuid, p_credits integer)
returns void language plpgsql volatile security definer set search_path = public
as $$
declare
  v_over text;
begin
  if p_credits is null or p_credits <= 0 then
    return;
  end if;
  with recursive up as (
    select * from public.work_orders where id = p_id
    union all
    select o.* from public.work_orders o join up on o.id = up.parent_id
  )
  select title into v_over from up where spent_credits + p_credits > budget_credits limit 1;
  if v_over is not null then
    raise exception 'Over budget: “%” has no credits left for this.', v_over using errcode = 'P0001';
  end if;
  with recursive up as (
    select id, parent_id from public.work_orders where id = p_id
    union all
    select o.id, o.parent_id from public.work_orders o join up on o.id = up.parent_id
  )
  update public.work_orders set spent_credits = spent_credits + p_credits, updated_at = now()
  where id in (select id from up);
end;
$$;

revoke all on function public.work_order_department(text) from public, anon, authenticated;
revoke all on function public.work_order_event(public.work_orders, text, text) from public, anon, authenticated;
revoke all on function public.work_order_move(uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.work_order_create(uuid, date, uuid, text, text, jsonb, integer, timestamptz, uuid[], text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.work_order_spend(uuid, integer) from public, anon, authenticated;

-- The week's tree from the calendar `cmo_plan_week` just wrote. Rerunning the plan replaces the orders of
-- calendar items it replaced; orders already under way stay. Video items wait for Studio orders (B3).
create or replace function public.work_orders_plan_week(p_user uuid, p_run uuid)
returns public.work_orders language plpgsql volatile security definer set search_path = public
as $$
declare
  v_week date := date_trunc('week', current_date)::date;
  v_root public.work_orders;
  v_goal text;
  v_budget integer;
  v_item record;
  v_free integer;
  v_price integer;
begin
  select * into v_root from public.work_orders where user_id = p_user and week = v_week and parent_id is null for update;
  if not found then
    select goal into v_goal from public.cmo_goals where user_id = p_user and week = v_week and status = 'approved';
    select weekly_credit_budget into v_budget from public.profiles where id = p_user;
    v_root := public.work_order_create(p_user, v_week, null, 'plan_week',
      coalesce('Week of ' || to_char(v_week, 'Mon DD') || ': ' || v_goal, 'Week of ' || to_char(v_week, 'Mon DD')),
      jsonb_build_object('objective', coalesce(v_goal, 'Plan and run this week''s marketing.')),
      coalesce(v_budget, 0), (v_week + 7)::timestamptz);
  end if;
  update public.work_orders set run_id = coalesce(run_id, p_run), updated_at = now() where id = v_root.id returning * into v_root;
  if v_root.status = 'queued' then
    v_root := public.work_order_move(v_root.id, 'running', 'Planned the week');
  end if;

  -- Orders whose calendar item the new plan deleted.
  for v_item in
    select id from public.work_orders where root_id = v_root.id and item_id is null and run_id is null
      and kind in ('post_draft', 'sales_scan') and status = 'queued' and created_by = 'loop' and id <> v_root.id
  loop
    perform public.work_order_move(v_item.id, 'cancelled', 'Dropped from the new plan');
  end loop;

  for v_item in
    select c.id, c.department, c.idea, c.day from public.content_items c
    where c.user_id = p_user and c.run_id = p_run and c.status = 'planned' and c.department in ('post', 'sales')
      and not exists (select 1 from public.work_orders o where o.item_id = c.id)
    order by c.day, c.created_at
  loop
    v_price := public.cmo_job_price(case v_item.department when 'post' then 'post_draft' else 'sales_scan' end);
    v_free := v_root.budget_credits - v_root.spent_credits - coalesce((
      select sum(budget_credits - spent_credits) from public.work_orders
      where parent_id = v_root.id and status not in ('done', 'failed', 'cancelled')), 0);
    -- Past the weekly budget the order is still planned, with nothing to spend: it shows as over budget.
    perform public.work_order_create(p_user, v_week, v_root.id,
      case v_item.department when 'post' then 'post_draft' else 'sales_scan' end, v_item.idea,
      jsonb_build_object('objective', v_item.idea, 'done_when',
        case v_item.department when 'post' then 'A draft waits on the founder''s card.' else 'Threads worth a reply wait on cards.' end),
      least(v_price, greatest(v_free, 0)), (v_item.day + 1)::timestamptz, '{}', 'loop', v_item.id);
  end loop;

  if not exists (select 1 from public.work_orders where root_id = v_root.id and kind = 'review_week') then
    perform public.work_order_create(p_user, v_week, v_root.id, 'review_week', 'Sunday review',
      jsonb_build_object('objective', 'Measure the week against its goal and propose the next one.'),
      0, (v_week + 6)::timestamptz + interval '12 hours');
  end if;
  return v_root;
end;
$$;
revoke all on function public.work_orders_plan_week(uuid, uuid) from public, anon, authenticated;

-- Same as 20261014090000 plus the tree: the calendar and its orders are written in one transaction.
create or replace function public.cmo_plan_week(p_user uuid, p_run uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_day date;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'This plan is not valid.' using errcode = '22023';
  end if;
  delete from public.content_items where user_id = p_user and status = 'planned' and day >= current_date;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_day := (v_item->>'day')::date;
    if v_day < current_date or v_day > current_date + 13 then
      continue;
    end if;
    insert into public.content_items (user_id, run_id, department, platform, day, idea, reason)
    values (
      p_user, p_run, v_item->>'department', left(v_item->>'platform', 20), v_day,
      left(v_item->>'idea', 300), left(coalesce(v_item->>'reason', ''), 300)
    );
    v_count := v_count + 1;
  end loop;
  -- The tree only tracks the plan: a fault in it must not lose the calendar.
  begin
    perform public.work_orders_plan_week(p_user, p_run);
  exception when others then
    raise warning 'work_orders_plan_week failed for run %: %', p_run, sqlerrm;
  end;
  return v_count;
end;
$$;

-- The order a run belongs to: the one already holding it, else the earliest open order of its kind this week,
-- else (a run started by hand, from chat or MCP) a new order under the week's root. No root: not tracked.
create or replace function public.work_order_for_run(p_run public.cmo_runs)
returns public.work_orders language plpgsql volatile security definer set search_path = public
as $$
declare
  v_row public.work_orders;
  v_root public.work_orders;
  v_source text := p_run.input->>'source';
begin
  select * into v_row from public.work_orders where run_id = p_run.id limit 1;
  if found or p_run.kind in ('onboard', 'plan_week') then
    return v_row;
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
        when 'post_draft' then 'Draft a post' when 'sales_scan' then coalesce(p_run.input->>'brief', 'Scan Reddit')
        when 'competitor_research' then 'Competitor research' when 'pull_metrics' then 'Pull post metrics'
        when 'summarize_memory' then 'Weekly memory' when 'review_week' then 'Sunday review' else p_run.kind end,
      jsonb_build_object('objective', coalesce(p_run.input->>'brief', p_run.kind)), 0, null, '{}',
      case when v_source in ('chat', 'mcp') then v_source when v_source = 'schedule' then 'loop' else 'founder' end);
  end if;
  update public.work_orders set run_id = p_run.id, updated_at = now() where id = v_row.id returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.work_order_for_run(public.cmo_runs) from public, anon, authenticated;

-- A finished run: its rows become deliverables (of the order they were planned for, when there is one), the
-- credits it kept count against the tree, and the order waits on the founder while a card waits.
create or replace function public.work_order_finish_run(p_run public.cmo_runs, p_order public.work_orders)
returns void language plpgsql volatile security definer set search_path = public
as $$
declare
  v_ref record;
  v_target public.work_orders;
  v_targets uuid[] := array[p_order.id];
  v_refunded boolean := coalesce((p_run.output->>'refund')::boolean, false);
begin
  if p_run.status = 'failed' then
    perform public.work_order_move(p_order.id, 'failed', null,
      jsonb_build_object('code', 'run_failed', 'message', left(coalesce(p_run.error, 'Something went wrong.'), 300),
        'retryable', true, 'repair_hint', null));
    return;
  end if;
  for v_ref in
    select 'post' as kind, 'content_item' as ref_kind, id, status = 'in_review' as waiting, id as item_id
      from public.content_items where run_id = p_run.id and department = 'post' and status <> 'planned'
    union all select 'reply', 'opportunity', id, status = 'in_review', null::uuid from public.opportunities where run_id = p_run.id
    union all select 'insight', 'insight', id, false, null::uuid from public.cmo_insights where run_id = p_run.id
  loop
    select * into v_target from public.work_orders where item_id = v_ref.item_id and v_ref.item_id is not null limit 1;
    if not found then
      v_target := p_order;
    end if;
    insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
    values (p_run.user_id, v_target.id, v_ref.kind, v_ref.ref_kind, v_ref.id, case when v_ref.waiting then 'waiting_founder' else 'ready' end)
    on conflict (ref_kind, ref_id) do nothing;
    if v_target.id <> p_order.id then
      update public.work_orders set run_id = p_run.id, updated_at = now() where id = v_target.id and run_id is null;
      v_targets := v_targets || v_target.id;
    end if;
  end loop;
  if not v_refunded and p_run.credits > 0 then
    begin
      perform public.work_order_spend(p_order.id, p_run.credits);
    exception when sqlstate 'P0001' then
      -- The credits are already settled on the run; the tree records the overrun for the progress check.
      perform public.work_order_event(p_order, 'note', 'Spent ' || p_run.credits || ' credits over the budget of “' || p_order.title || '”');
    end;
  end if;
  for v_target in select * from public.work_orders where id = any(v_targets) and status not in ('done', 'failed', 'cancelled') loop
    if v_target.status = 'queued' and exists (select 1 from public.deliverables where order_id = v_target.id) then
      v_target := public.work_order_move(v_target.id, 'running');
    end if;
    if exists (select 1 from public.deliverables where order_id = v_target.id and status = 'waiting_founder') then
      perform public.work_order_move(v_target.id, 'waiting_founder');
    elsif exists (select 1 from public.deliverables where order_id = v_target.id) then
      perform public.work_order_move(v_target.id, 'done');
    elsif v_target.id = p_order.id and cardinality(v_targets) = 1 then
      perform public.work_order_move(v_target.id, 'done', null, null,
        coalesce(left(p_run.output->>'reason', 200), 'Finished with nothing to approve this time.'));
    end if;
  end loop;
  -- The guess went to another order: this one is free for the next run of its kind.
  if exists (select 1 from public.work_orders where id = p_order.id and status = 'running') then
    update public.work_orders set run_id = null where id = p_order.id;
    perform public.work_order_move(p_order.id, 'queued');
  end if;
end;
$$;
revoke all on function public.work_order_finish_run(public.cmo_runs, public.work_orders) from public, anon, authenticated;

create or replace function public.work_orders_follow_run() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.work_orders;
begin
  if tg_op = 'UPDATE' and old.status = new.status then
    return new;
  end if;
  -- Orders follow runs; they never hold one back. A fault rolls back only the tree's change.
  begin
    v_order := public.work_order_for_run(new);
    if v_order.id is null or new.kind = 'plan_week' then
      return new;
    end if;
    if new.status = 'running' then
      perform public.work_order_move(v_order.id, 'running');
    elsif new.status = 'queued' and tg_op = 'UPDATE' then
      -- Deferred by the runner (`cmo_defer_run`) or put back after a lost lease.
      if v_order.status = 'running' then
        perform public.work_order_move(v_order.id, 'deferred');
      end if;
    elsif new.status in ('done', 'failed') then
      if v_order.status = 'queued' then
        perform public.work_order_move(v_order.id, 'running');
        v_order.status := 'running';
      end if;
      perform public.work_order_finish_run(new, v_order);
    end if;
  exception when others then
    raise warning 'work orders did not follow run %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.work_orders_follow_run() from public, anon, authenticated;
create trigger work_orders_follow_run after insert or update of status on public.cmo_runs
  for each row execute function public.work_orders_follow_run();

-- A decided card decides its deliverable; an order whose deliverables are all decided is done.
create or replace function public.work_orders_follow_approval() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.work_orders;
  v_ref_kind text := case new.ref_kind when 'content_item' then 'content_item' when 'opportunity' then 'opportunity' end;
begin
  if old.status <> 'waiting' or new.status = 'waiting' or v_ref_kind is null then
    return new;
  end if;
  -- A superseded card is replaced by a new waiting one: the deliverable still waits.
  if new.status = 'cancelled' and exists (select 1 from public.approvals
      where ref_kind = new.ref_kind and ref_id = new.ref_id and status = 'waiting') then
    return new;
  end if;
  begin
    update public.deliverables set status = 'decided' where ref_kind = v_ref_kind and ref_id = new.ref_id;
    for v_order in
      select o.* from public.work_orders o join public.deliverables d on d.order_id = o.id
      where d.ref_kind = v_ref_kind and d.ref_id = new.ref_id and o.status = 'waiting_founder'
    loop
      if not exists (select 1 from public.deliverables where order_id = v_order.id and status = 'waiting_founder') then
        perform public.work_order_move(v_order.id, 'done', case new.status
          when 'approved' then 'You approved “' || v_order.title || '”'
          when 'edited' then 'You edited and approved “' || v_order.title || '”'
          when 'skipped' then 'You skipped “' || v_order.title || '”'
          else 'Finished “' || v_order.title || '”' end);
      end if;
    end loop;
  exception when others then
    raise warning 'work orders did not follow card %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.work_orders_follow_approval() from public, anon, authenticated;
create trigger work_orders_follow_approval after update of status on public.approvals
  for each row execute function public.work_orders_follow_approval();

commit;
