-- Charge before running (plan 2026-11-06, phase 5): a Studio order holds credits before its team calls a model.
--
-- Until now the video team's model calls (Director, clip editor, slideshow writer) were charged after the fact and
-- clamped to the balance (`studio_record_usage`), so a founder at 0 credits still got them for free (review C1). The
-- runner now holds a small allowance on the order before the first call; usage is charged against it, and what the
-- team did not use comes back when the order ends. The media of a video are held by their own job
-- (`credit_orders`, phase 2), confirmed on the storyboard card.

-- Credits a Studio order holds before its team works: a Director plan with one revision is about 1-2 credits.
create or replace function public.studio_plan_hold() returns integer
language sql immutable set search_path = public as $$ select 5 $$;

-- Holds the allowance once per order (a retried order keeps what it holds). Refuses below the balance, before any
-- model is called.
create or replace function public.studio_order_hold(p_order_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.require_user();
  v_held integer;
begin
  if not public.studio_brain_call() then
    raise exception 'Only OpenCMO''s Studio team can do this.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.work_orders
    where id = p_order_id and user_id = v_user and kind in ('build_video', 'cut_shorts', 'build_slideshow', 'build_post_image')
      and status not in ('done', 'cancelled')
  ) then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  perform public.lock_credit_owner(v_user);
  v_held := public.credit_held('work_order', p_order_id);
  if v_held >= public.studio_plan_hold() then
    return v_held;
  end if;
  perform public.credit_hold(v_user, 'work_order', p_order_id, public.studio_plan_hold() - v_held, 'CMO video team hold');
  return public.studio_plan_hold();
end;
$$;

-- An order that ends keeps only what its team used; the rest of the allowance goes back.
create or replace function public.studio_order_release_hold() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_held integer;
  v_used integer;
begin
  if new.status not in ('done', 'failed', 'cancelled') or old.status in ('done', 'failed', 'cancelled') then
    return new;
  end if;
  perform public.lock_credit_owner(new.user_id);
  v_held := public.credit_held('work_order', new.id);
  if v_held <= 0 then
    return new;
  end if;
  v_used := public.agent_credits((select coalesce(sum(micro_usd), 0)::bigint from public.work_order_usage where order_id = new.id));
  if v_used < v_held then
    perform public.credit_settle(new.user_id, 'work_order', new.id, v_used, 'CMO video team hold returned');
  end if;
  return new;
end;
$$;

drop trigger if exists work_orders_release_hold on public.work_orders;
create trigger work_orders_release_hold after update of status on public.work_orders
  for each row execute function public.studio_order_release_hold();

revoke all on function public.studio_plan_hold() from public, anon;
grant execute on function public.studio_plan_hold() to authenticated, service_role;
revoke all on function public.studio_order_hold(uuid) from public, anon;
grant execute on function public.studio_order_hold(uuid) to authenticated, service_role;
revoke all on function public.studio_order_release_hold() from public, anon, authenticated;
