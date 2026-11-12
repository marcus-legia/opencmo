-- Planned posts and Reddit scans whose day passed without a draft leave the calendar.
--
-- The daily schedule drafts one due post per platform, the oldest first. One missed day (the founder out of credits,
-- the CMO paused, a failed run) left an item behind, and from then on every post was drafted a day after its date:
-- the backlog never shrank. An account that stopped paying kept its planned items for ever, and the schedule read
-- them every day. After `p_days` days late an item is dropped, as a replan drops the planned items it replaces, and
-- its open work order is cancelled with the reason, so the week's order tree says what happened.
--
-- Video items are left alone: a script waits on the founder, not on the schedule.

create or replace function public.cmo_expire_planned(p_days integer default 2)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_order record;
  v_count integer := 0;
begin
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'Invalid number of days.' using errcode = '22023';
  end if;
  for v_item in
    select c.id from public.content_items c
    where c.status = 'planned' and c.department in ('post', 'sales') and c.day < current_date - p_days
      -- A run already named this item: it drafts it, or finds it gone and gives the credit back.
      and not exists (
        select 1 from public.cmo_runs r
        where r.user_id = c.user_id and r.status in ('queued', 'running') and r.input->>'item_id' = c.id::text)
    order by c.day, c.id
    for update of c skip locked
  loop
    for v_order in
      select o.id from public.work_orders o where o.item_id = v_item.id and o.status in ('queued', 'deferred')
    loop
      perform public.work_order_move(v_order.id, 'cancelled', 'Its day passed before it was drafted');
    end loop;
    delete from public.content_items where id = v_item.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.cmo_expire_planned(integer) from public, anon, authenticated;
grant execute on function public.cmo_expire_planned(integer) to service_role;
