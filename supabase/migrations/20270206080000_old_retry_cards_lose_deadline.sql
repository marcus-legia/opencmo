-- Retry cards raised before 20270206030000 lose the deadline they were raised with.
--
-- 20270206030000 stopped giving a failure card `expires_at = window_ends_at`, but only for cards raised from then on.
-- A Retry card already waiting kept its old deadline, 15 minutes after the post's time, so the app shows it as
-- "This card expired. A new one will ask again." (`lib/screens/cards.ts`). From 20270206020000 that same waiting card
-- is what stops `schedule_propose` from making a twin, so the new card it promises never comes: the post is stuck,
-- and the only card that could free it reads as dead.
--
-- Every failure card still undecided gets the deadline a failure card has now: none. Reruns change nothing.

create or replace function public.schedule_failure_cards_reopen() returns integer
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  v_n integer;
begin
  update public.approvals a
  set expires_at = null
  from public.schedule_slots s
  where a.ref_kind = 'schedule_slot' and a.ref_id = s.id and a.kind = 'schedule'
    and a.status in ('waiting', 'held') and a.expires_at is not null
    and s.status = 'failed' and s.error is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.schedule_failure_cards_reopen() from public, anon, authenticated;

select public.schedule_failure_cards_reopen();
