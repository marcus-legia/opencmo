-- 20261228120000: P2 A2, video orders (plan F4; sessions/A.md A2).
--
-- The week plan may hold one video item; it becomes a `build_video` order under the week's root. Studio's orders are
-- not `cmo_runs`: the order runner (`apps/web/lib/cmo/jobs/studio-orders.ts`) claims them here with the service role
-- and drives B's adapter as the brain, under the founder's short-lived JWT. Its loop:
--   queued `build_video` → buildVideo → card 1 (`waiting_founder`)
--   approved step → decide; its `next` (card 2, or the render) waits on `wait_for` generations (`waiting_order`)
--   every `wait_for` generation finished → card 2 (`waiting_founder`) or the render; A3's rules raise card 3
--   queued `cut_shorts` → cutShorts → renders (`waiting_order`); A3's rules raise the batch card.
-- Order states move only through `work_order_move` (here and in A3's rules).

begin;

alter table public.studio_steps add column next jsonb
  check (next is null or (jsonb_typeof(next) = 'object' and next ? 'tool' and octet_length(next::text) <= 65536));
alter table public.studio_steps add column wait_for uuid[] not null default '{}' check (cardinality(wait_for) <= 60);
alter table public.studio_steps add column next_done_at timestamptz;
-- The raw tool input a stored step was planned from: a redone keyframe re-plans card 2 from it.
alter table public.studio_steps add column plan_input jsonb
  check (plan_input is null or (jsonb_typeof(plan_input) = 'object' and octet_length(plan_input::text) <= 65536));
-- The runner's claim on an approved step; a claim older than ten minutes is a crashed runner and is taken again.
alter table public.studio_steps add column claimed_at timestamptz;

-- What the order budgets for a video before its cards price it (keyframes + shots of a 30 s long take); the cards
-- show the real price, and spending past the budget is recorded, never refused (20261227110000).
create or replace function public.studio_video_budget() returns integer language sql immutable as $$ select 60 $$;
revoke all on function public.studio_video_budget() from public, anon, authenticated;

-- Same as 20261228110000, plus `waiting_order` and `deferred` pass through `running` too.
create or replace function public.work_order_wait_founder(p_id uuid, p_text text)
returns void language plpgsql volatile security definer set search_path = public
as $$
declare
  v_status text := (select status from public.work_orders where id = p_id);
begin
  if v_status is null or v_status in ('waiting_founder', 'done', 'failed', 'cancelled') then
    return;
  end if;
  if v_status <> 'running' then
    perform public.work_order_move(p_id, 'running');
  end if;
  perform public.work_order_move(p_id, 'waiting_founder', p_text);
end;
$$;
revoke all on function public.work_order_wait_founder(uuid, text) from public, anon, authenticated;

-- The runner's one door to an order's state: `running`, `waiting_founder`, `waiting_order`, `failed` (needs
-- `p_error`). A finished or cancelled order is left alone (the founder cancelled it meanwhile).
create or replace function public.studio_order_move(p_id uuid, p_to text, p_text text default null, p_error jsonb default null)
returns void language plpgsql volatile security definer set search_path = public
as $$
declare
  v_status text := (select status from public.work_orders where id = p_id and kind in ('build_video', 'cut_shorts'));
begin
  if v_status is null or v_status in ('done', 'failed', 'cancelled') or v_status = p_to then
    return;
  end if;
  -- A card waits on the founder (a batch card raised while the runner was still finishing): it stays waiting. An
  -- approved card goes back to work through the claims' `running`, never straight to `waiting_order`.
  if p_to = 'waiting_order' and v_status = 'waiting_founder' then
    return;
  end if;
  if p_to = 'waiting_founder' then
    perform public.work_order_wait_founder(p_id, p_text);
  elsif p_to in ('waiting_order', 'running') then
    if v_status <> 'running' then
      perform public.work_order_move(p_id, 'running');
    end if;
    if p_to = 'waiting_order' then
      perform public.work_order_move(p_id, 'waiting_order', p_text);
    end if;
  elsif p_to = 'failed' then
    perform public.work_order_move(p_id, 'failed', p_text, p_error);
  else
    raise exception 'The order runner cannot move an order to %.', p_to using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.studio_order_move(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.studio_order_move(uuid, text, text, jsonb) to service_role;

-- Queued Studio orders, claimed by moving them to `running` (one runner each, `skip locked`). A paused founder's
-- orders wait. `p_order` claims that one order only (the approvals route kicks the runner for it).
create or replace function public.studio_orders_claim(p_order uuid default null, p_limit integer default 3)
returns setof public.work_orders language plpgsql volatile security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  for v_id in
    select o.id from public.work_orders o
    where o.status = 'queued' and o.kind in ('build_video', 'cut_shorts') and (p_order is null or o.id = p_order)
      and not public.cmo_paused(o.user_id)
    order by o.created_at
    limit greatest(1, least(coalesce(p_limit, 3), 10))
    for update skip locked
  loop
    return next public.work_order_move(v_id, 'running');
  end loop;
end;
$$;
revoke all on function public.studio_orders_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.studio_orders_claim(uuid, integer) to service_role;

-- Approved steps of live orders, claimed for the runner to decide through the adapter. The status stays `approved`
-- (the adapter reads only waiting or approved steps); `claimed_at` keeps a second runner off it. A step whose
-- earlier claim never finished is not decided again (a redo would make a second keyframe, a video placed twice):
-- it fails, with its order, and the progress check replans. The spend is recorded when the step starts
-- (`studio_step_finish`), not here.
create or replace function public.studio_steps_claim(p_limit integer default 5)
returns setof public.studio_steps language plpgsql volatile security definer set search_path = public
as $$
declare
  v_row public.studio_steps;
begin
  for v_row in
    select s.* from public.studio_steps s
    join public.work_orders o on o.id = s.order_id
    where s.status = 'approved' and o.status not in ('done', 'failed', 'cancelled') and not public.cmo_paused(s.user_id)
      and (s.claimed_at is null or s.claimed_at < now() - interval '10 minutes')
    order by s.decided_at
    limit greatest(1, least(coalesce(p_limit, 5), 10))
    for update of s skip locked
  loop
    if v_row.claimed_at is not null then
      update public.studio_steps set status = 'failed', error = 'Studio stopped while starting this step.' where id = v_row.id;
      perform public.studio_order_move(v_row.order_id, 'failed', null, jsonb_build_object('code', 'step_interrupted',
        'message', 'Studio stopped while starting a step. Nothing more will run for it.', 'retryable', true));
      continue;
    end if;
    update public.studio_steps set claimed_at = now() where id = v_row.id returning * into v_row;
    perform public.studio_order_move(v_row.order_id, 'running');
    return next v_row;
  end loop;
end;
$$;
revoke all on function public.studio_steps_claim(integer) from public, anon, authenticated;
grant execute on function public.studio_steps_claim(integer) to service_role;

-- Steps whose `next` can run: every generation it waits on has finished (done, failed or cancelled; the runner reads
-- which and fails the order on a failure). Claimed by stamping `next_done_at`, so it runs once.
create or replace function public.studio_steps_ready(p_limit integer default 5)
returns setof public.studio_steps language plpgsql volatile security definer set search_path = public
as $$
declare
  v_row public.studio_steps;
begin
  for v_row in
    select s.* from public.studio_steps s
    join public.work_orders o on o.id = s.order_id
    where s.next is not null and s.next_done_at is null and o.status not in ('done', 'failed', 'cancelled')
      and not public.cmo_paused(s.user_id)
      and not exists (select 1 from unnest(s.wait_for) w(id) join public.generations g on g.id = w.id
                      where g.status in ('queued', 'running'))
    order by s.decided_at
    limit greatest(1, least(coalesce(p_limit, 5), 10))
    for update of s skip locked
  loop
    update public.studio_steps set next_done_at = now(), status = case when status = 'running' then 'done' else status end
    where id = v_row.id returning * into v_row;
    return next v_row;
  end loop;
end;
$$;
revoke all on function public.studio_steps_ready(integer) from public, anon, authenticated;
grant execute on function public.studio_steps_ready(integer) to service_role;

-- The raw input of a step the runner just stored (`plan(…, { store: true })` does not carry it).
create or replace function public.studio_step_plan_input(p_id uuid, p_input jsonb)
returns void language sql volatile security definer set search_path = public
as $$ update public.studio_steps set plan_input = p_input where id = p_id and plan_input is null $$;
revoke all on function public.studio_step_plan_input(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.studio_step_plan_input(uuid, jsonb) to service_role;

-- Studio work a call to `/api/internal/cmo/run` would pick up now: Modal's sweep adds it to the queued runs it
-- counts, so the runner is called within a minute even when no CMO run waits.
create or replace function public.studio_work_count() returns integer
language sql stable security definer set search_path = public
as $$
  select (
    (select count(*) from public.work_orders o where o.status = 'queued' and o.kind in ('build_video', 'cut_shorts')
       and not public.cmo_paused(o.user_id))
    + (select count(*) from public.studio_steps s join public.work_orders o on o.id = s.order_id
       where s.status = 'approved' and o.status not in ('done', 'failed', 'cancelled') and not public.cmo_paused(s.user_id)
         and (s.claimed_at is null or s.claimed_at < now() - interval '10 minutes'))
    + (select count(*) from public.studio_steps s join public.work_orders o on o.id = s.order_id
       where s.next is not null and s.next_done_at is null and o.status not in ('done', 'failed', 'cancelled')
         and not public.cmo_paused(s.user_id)
         and not exists (select 1 from unnest(s.wait_for) w(id) join public.generations g on g.id = w.id
                         where g.status in ('queued', 'running')))
  )::integer
$$;
revoke all on function public.studio_work_count() from public, anon, authenticated;
grant execute on function public.studio_work_count() to service_role;

-- Same as 20261228100000, plus what the step waits on and runs next (B's `decide` hands back `next`), and `running`
-- for a step that waits on its generations. Signature changes, so the old one goes.
drop function public.studio_step_finish(uuid, text, text, uuid);
create or replace function public.studio_step_finish(p_id uuid, p_status text, p_error text default null,
  p_generation_id uuid default null, p_next jsonb default null, p_wait_for uuid[] default null)
returns public.studio_steps language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_row public.studio_steps;
  v_ok boolean;
begin
  if not public.studio_brain_call() then
    raise exception 'Only OpenCMO''s Studio team can do this.' using errcode = '42501';
  end if;
  select * into v_row from public.studio_steps where id = p_id and user_id = v_user for update;
  if not found then
    raise exception 'Step not found.' using errcode = 'P0002';
  end if;
  if v_row.status = p_status and p_next is null then
    return v_row;
  end if;
  v_ok := v_row.status = p_status or case v_row.status
    when 'waiting' then p_status = 'cancelled'
    when 'approved' then p_status in ('running', 'done', 'failed', 'cancelled')
    when 'running' then p_status in ('done', 'failed', 'cancelled')
    else false end;
  if not coalesce(v_ok, false) then
    raise exception 'A step cannot go from % to %.', v_row.status, p_status using errcode = 'P0001';
  end if;
  if p_status = 'failed' and nullif(trim(coalesce(p_error, '')), '') is null then
    raise exception 'A failed step needs its error.' using errcode = '22023';
  end if;
  if p_next is not null and (jsonb_typeof(p_next) <> 'object' or not p_next ? 'tool') then
    raise exception 'The next step is malformed.' using errcode = '22023';
  end if;
  -- A next step is set once, when the step itself runs: never on a step already done, failed or cancelled.
  if p_next is not null and v_row.status not in ('approved', 'running') then
    raise exception 'This step has already run.' using errcode = 'P0001';
  end if;
  -- The week's "credits used": what the step starts spending, recorded once as it leaves `approved` (a decide that
  -- failed spent nothing). A redone keyframe costs what its generation holds.
  if v_row.status = 'approved' and p_status in ('running', 'done') and v_row.order_id is not null then
    if v_row.decision = 'approve' then
      perform public.work_order_spend(v_row.order_id, v_row.price_credits);
    elsif v_row.decision = 'redo' and p_generation_id is not null then
      perform public.work_order_spend(v_row.order_id,
        coalesce((select credits_reserved from public.generations where id = p_generation_id and user_id = v_user), 0));
    end if;
  end if;
  if p_wait_for is not null and exists (select 1 from unnest(p_wait_for) w(id)
      where not exists (select 1 from public.generations g where g.id = w.id and g.user_id = v_user)) then
    raise exception 'A step only waits on the founder''s own generations.' using errcode = '22023';
  end if;
  update public.studio_steps
  set status = p_status,
      decision = case when v_row.status = 'waiting' then 'cancel' else decision end,
      decided_at = coalesce(decided_at, now()),
      error = case when p_status = 'failed' then left(p_error, 500) else error end,
      generation_id = coalesce(p_generation_id, generation_id),
      next = coalesce(p_next, next),
      wait_for = coalesce(p_wait_for, wait_for),
      next_done_at = case when p_next is not null then null else next_done_at end
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.studio_step_finish(uuid, text, text, uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.studio_step_finish(uuid, text, text, uuid, jsonb, uuid[]) to authenticated;

-- Same as 20261227110000, plus video items: each becomes a `build_video` order under Studio with a brief from the
-- item (the plan keeps it to one a week unless the founder asks for more), budgeted up to `studio_video_budget()`.
create or replace function public.work_orders_plan_week(p_user uuid, p_run uuid)
returns public.work_orders language plpgsql volatile security definer set search_path = public
as $$
declare
  v_week date := date_trunc('week', current_date)::date;
  v_root public.work_orders;
  v_item record;
  v_free integer;
  v_price integer;
begin
  v_root := public.work_order_week_root(p_user);
  update public.work_orders set run_id = coalesce(run_id, p_run), updated_at = now() where id = v_root.id returning * into v_root;
  if v_root.status = 'queued' then
    v_root := public.work_order_move(v_root.id, 'running', 'Planned the week');
  end if;

  -- Orders whose calendar item the new plan deleted.
  for v_item in
    select id from public.work_orders where root_id = v_root.id and item_id is null and run_id is null
      and kind in ('post_draft', 'sales_scan', 'build_video') and status = 'queued' and created_by = 'loop' and id <> v_root.id
  loop
    perform public.work_order_move(v_item.id, 'cancelled', 'Dropped from the new plan');
  end loop;

  for v_item in
    select c.id, c.department, c.idea, c.reason, c.platform, c.day from public.content_items c
    where c.user_id = p_user and c.run_id = p_run and c.status = 'planned' and c.department in ('post', 'sales', 'video')
      and not exists (select 1 from public.work_orders o where o.item_id = c.id)
    order by c.day, c.created_at
  loop
    v_free := v_root.budget_credits - v_root.spent_credits - coalesce((
      select sum(budget_credits - spent_credits) from public.work_orders
      where parent_id = v_root.id and status not in ('done', 'failed', 'cancelled')), 0);
    if v_item.department = 'video' then
      -- The replan deleted the item of a video already under way (its order lost `item_id`): the new item is that
      -- same video, not a second one this week.
      update public.work_orders set item_id = v_item.id, updated_at = now()
      where id = (select id from public.work_orders where root_id = v_root.id and kind = 'build_video' and item_id is null
                    and status not in ('done', 'failed', 'cancelled') order by created_at limit 1);
      if found then
        continue;
      end if;
      perform public.work_order_create(p_user, v_week, v_root.id, 'build_video', v_item.idea,
        jsonb_build_object('objective', v_item.idea, 'angle', coalesce(v_item.reason, ''), 'seconds', 30, 'aspect', '9:16',
          'platform', v_item.platform, 'done_when', 'The founder approved the finished video.'),
        least(public.studio_video_budget(), greatest(v_free, 0)), (v_item.day + interval '23 hours 59 minutes') at time zone 'UTC',
        '{}', 'loop', v_item.id);
      continue;
    end if;
    v_price := public.cmo_job_price(case v_item.department when 'post' then 'post_draft' else 'sales_scan' end);
    -- Past the weekly budget the order is still planned, with nothing to spend: it shows as over budget.
    perform public.work_order_create(p_user, v_week, v_root.id,
      case v_item.department when 'post' then 'post_draft' else 'sales_scan' end, v_item.idea,
      jsonb_build_object('objective', v_item.idea, 'done_when',
        case v_item.department when 'post' then 'A draft waits on the founder''s card.' else 'Threads worth a reply wait on cards.' end),
      least(v_price, greatest(v_free, 0)), (v_item.day + interval '23 hours 59 minutes') at time zone 'UTC', '{}', 'loop', v_item.id);
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

commit;
