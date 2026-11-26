-- A founder whose plan lapsed keeps no connected posting account (owner 2026-11-26). Zernio bills each connected
-- account by the day whether it posts or not, and a founder without a plan cannot send a post anyway
-- (`paywall_on_send`), so an account left connected after the plan ends is a cost with nothing behind it.
--
-- "Lapsed" is `cmo_paid` turning false: the plan went back to free (canceled, expired or unpaid at Creem) and no
-- credits are left. A `past_due` subscription keeps its plan while Creem retries the card, so a failed payment that is
-- fixed in a few days loses nothing. The daily cleanup cron reads `lapsed_social_accounts`, disconnects each account at
-- Zernio first (an account removed only here would stay billable there), then drops it with `social_account_drop`.
--
-- `social_account_drop` is the body of `social_account_remove` (20270206050000) for a given founder, so a lapse
-- cancels the waiting posts and closes their cards exactly as a founder's own Disconnect does.

create or replace function public.social_account_drop(p_user uuid, p_id uuid) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  v_slots uuid[];
  v_dropped uuid[];
  v_slot uuid;
begin
  if not exists (select 1 from public.social_accounts where id = p_id and user_id = p_user) then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;
  -- A post has nowhere to go without the account: its slot and its card are dropped.
  with gone as (
    update public.schedule_slots s
    set status = 'cancelled', account_id = null, lease_until = null, updated_at = now()
    from public.deliverables d
    where d.id = s.deliverable_id and d.kind = 'post'
      and s.account_id = p_id and s.user_id = p_user and s.status in ('proposed', 'waiting')
    returning s.id
  )
  select coalesce(array_agg(id), '{}') into v_dropped from gone;
  -- A video or a photo post is the founder's own file: it still asks, to be posted by hand.
  with moved as (
    update public.schedule_slots
    set account_id = null, mode = 'intent', status = 'proposed', updated_at = now()
    where account_id = p_id and user_id = p_user and status in ('proposed', 'waiting')
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_slots from moved;
  delete from public.social_accounts where id = p_id and user_id = p_user;
  foreach v_slot in array v_dropped loop
    perform public.approval_close('schedule_slot', v_slot, 'cancelled');
  end loop;
  foreach v_slot in array v_slots loop
    perform public.approval_raise(p_user, 'schedule_slot', v_slot);
  end loop;
end;
$$;

revoke all on function public.social_account_drop(uuid, uuid) from public, anon, authenticated;
grant execute on function public.social_account_drop(uuid, uuid) to service_role;

-- The founder's own Disconnect: the same drop, for the signed-in founder only.
create or replace function public.social_account_remove(p_id uuid) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
begin
  perform public.social_account_drop(public.require_user(), p_id);
end;
$$;

revoke all on function public.social_account_remove(uuid) from public, anon, authenticated;
grant execute on function public.social_account_remove(uuid) to authenticated, service_role;

-- Posting accounts whose founder no longer has a plan, oldest first, for the cleanup cron. Any status: one that stopped
-- working at the platform (`reconnect`) is still an account at Zernio until it is removed there.
create or replace function public.lapsed_social_accounts(p_limit integer default 100)
  returns table (id uuid, user_id uuid, zernio_account_id text)
  language sql stable security definer
  set search_path to ''
as $$
  select a.id, a.user_id, a.zernio_account_id
  from public.social_accounts a
  where not public.cmo_paid(a.user_id)
  order by a.connected_at nulls first, a.id
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.lapsed_social_accounts(integer) from public, anon, authenticated;
grant execute on function public.lapsed_social_accounts(integer) to service_role;
