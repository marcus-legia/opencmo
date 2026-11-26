-- A Retry card waits until the founder decides it, not until the slot's window closes.
--
-- `approval_raise` gave a failure card `expires_at = window_ends_at`. `windowMinutes` is 15, so a card raised by a
-- failure was already past its deadline a quarter of an hour after the post's time. Nothing flips such a card to
-- `expired` (only `schedule_miss` does that, for a missed slot), so it stayed `waiting` in the Inbox but dropped out
-- of every view that hides a card past its deadline. The founder had a decision to make and no way to see it.
--
-- That deadline was there so Retry could still post at the approved time. It no longer has to be: `approval_decide`
-- on a failed slot past its window closes the card and asks for a new time (20270122010000), and from 20270206020000
-- the slot keeps its place while the card is undecided. So a failure card gets no deadline at all.
--
-- `expires_at` also carried a second meaning: `card_budget_take(p_user, v_expires is not null)` force-raises a card
-- with a deadline, so a timed card is never held by the daily card budget. A failure card must still reach the
-- founder — it is now what holds the slot — so the two meanings are split: `v_timed` says "always reach them",
-- `v_expires` says when it stops being worth showing. Every card but a failure card keeps exactly what it had.

create or replace function public.approval_raise(p_user uuid, p_ref_kind text, p_ref_id uuid) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  v_snapshot jsonb := public.approval_snapshot(p_ref_kind, p_ref_id);
  v_hash text;
  v_kind text;
  v_id uuid;
  v_expires timestamptz;
  v_prev public.approvals;
  v_status text := 'waiting';
  v_held_until timestamptz;
  -- A schedule card is tied to a time, so it always reaches the founder whatever the day's card budget says. A
  -- failure card is one of them even though it has no deadline of its own.
  v_timed boolean := false;
begin
  if v_snapshot is null then
    return;
  end if;
  v_hash := public.approval_hash(v_snapshot);
  if exists (select 1 from public.approvals
             where ref_kind = p_ref_kind and ref_id = p_ref_id and status in ('waiting', 'held') and content_hash = v_hash) then
    return;
  end if;
  select * into v_prev from public.approvals
  where ref_kind = p_ref_kind and ref_id = p_ref_id and status in ('waiting', 'held') for update;
  update public.approvals set status = 'cancelled', decided_at = now()
  where ref_kind = p_ref_kind and ref_id = p_ref_id and status in ('waiting', 'held');
  v_kind := v_snapshot->>'kind';
  -- A failure card (it carries the last error) waits until the founder decides it: Retry then asks for a new time.
  -- Any other schedule card expires at its time.
  if v_kind = 'schedule' then
    v_timed := true;
    select case when s.error is null then s.publish_at end into v_expires
    from public.schedule_slots s where s.id = p_ref_id;
  end if;
  if v_prev.id is not null then
    -- A replacement keeps its place: not counted again, still held if the old one was.
    v_status := case when v_prev.status = 'held' and not v_timed then 'held' else 'waiting' end;
    v_held_until := case when v_status = 'held' then v_prev.held_until end;
  elsif not public.card_budget_take(p_user, v_timed) then
    v_status := 'held';
    v_held_until := public.card_budget_next_day(p_user);
  end if;
  -- A schedule card carries its time and account in the foot and expires when its time comes (rule 4).
  insert into public.approvals (user_id, kind, department, ref_kind, ref_id, snapshot, content_hash, price_credits,
    post_at, account, expires_at, status, held_until)
  values (p_user, v_kind,
    case v_kind when 'post' then 'writer' when 'reply' then 'sales'
      when 'script' then 'studio' when 'price' then 'studio' when 'finished_video' then 'studio'
      when 'shorts_batch' then 'studio' when 'slideshow' then 'studio' when 'schedule' then 'schedule' else 'brain' end,
    p_ref_kind, p_ref_id, v_snapshot, v_hash,
    case when v_kind in ('script', 'price') then (v_snapshot->>'price_credits')::integer end,
    case when v_kind = 'schedule' then (v_snapshot->>'publish_at')::timestamptz end,
    case when v_kind = 'schedule' then left(v_snapshot->>'handle', 100) end,
    v_expires, v_status, v_held_until)
  returning id into v_id;
  if v_kind = 'schedule' then
    update public.schedule_slots set approval_id = v_id, updated_at = now() where id = p_ref_id;
  end if;
end;
$$;
revoke all on function public.approval_raise(uuid, text, uuid) from public, anon, authenticated;
