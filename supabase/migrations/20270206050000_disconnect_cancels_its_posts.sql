-- Disconnecting an account drops the posts waiting on it, instead of asking the founder to post them by hand.
--
-- `social_account_remove` moved every pending slot of the account to `mode = 'intent'`, `status = 'proposed'` and
-- raised a card for each. From 20270206040000 a post is scheduled only where an account is connected, so those
-- intent slots are exactly what must not exist: they sit on the calendar, ask the founder again, and can only settle
-- `failed` with `no_account`.
--
-- Posts are cancelled with their cards. A photo post and a video keep the old behaviour: those are the founder's own
-- files, and posting them by hand is a real choice (`intent` stays for them).
--
-- The words are not lost. The post itself stays in the Library; connecting the platform again schedules the posts
-- written after that.

create or replace function public.social_account_remove(p_id uuid) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  v_user uuid := public.require_user();
  v_slots uuid[];
  v_dropped uuid[];
  v_slot uuid;
begin
  if not exists (select 1 from public.social_accounts where id = p_id and user_id = v_user) then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;
  -- A post has nowhere to go without the account: its slot and its card are dropped.
  with gone as (
    update public.schedule_slots s
    set status = 'cancelled', account_id = null, lease_until = null, updated_at = now()
    from public.deliverables d
    where d.id = s.deliverable_id and d.kind = 'post'
      and s.account_id = p_id and s.user_id = v_user and s.status in ('proposed', 'waiting')
    returning s.id
  )
  select coalesce(array_agg(id), '{}') into v_dropped from gone;
  -- A video or a photo post is the founder's own file: it still asks, to be posted by hand.
  with moved as (
    update public.schedule_slots
    set account_id = null, mode = 'intent', status = 'proposed', updated_at = now()
    where account_id = p_id and user_id = v_user and status in ('proposed', 'waiting')
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_slots from moved;
  delete from public.social_accounts where id = p_id and user_id = v_user;
  foreach v_slot in array v_dropped loop
    perform public.approval_close('schedule_slot', v_slot, 'cancelled');
  end loop;
  foreach v_slot in array v_slots loop
    perform public.approval_raise(v_user, 'schedule_slot', v_slot);
  end loop;
end;
$$;
revoke all on function public.social_account_remove(uuid) from public, anon, authenticated;
grant execute on function public.social_account_remove(uuid) to authenticated, service_role;
