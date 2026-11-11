-- 20270117010000: "Show it now" on a draft the Writer lists as waiting but the queue does not show.
--
-- Two ways a draft ends up waiting with no card in the queue: its card is `held` (past the day's ten new cards,
-- 20270101130000), or its post is still `in_review` with no live card at all (its card was cancelled and never raised
-- again). The founder asked for it by hand, so it comes in now: a held card is released (counted on today's budget,
-- forced), and a post in review without a card gets one, released at once if the budget held it.

begin;

create or replace function public.approval_show_now(p_ref_kind text, p_ref_id uuid)
returns uuid language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_card public.approvals;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select * into v_card from public.approvals
  where ref_kind = p_ref_kind and ref_id = p_ref_id and status in ('waiting', 'held') and user_id = v_user
  for update;

  if v_card.id is null then
    -- Only a post still in review can ask for its card again; anything else has nothing to show.
    if p_ref_kind <> 'content_item' or not exists (
      select 1 from public.content_items where id = p_ref_id and user_id = v_user and status = 'in_review'
    ) then
      raise exception 'This draft has no card to show.' using errcode = 'P0002';
    end if;
    perform public.approval_raise(v_user, p_ref_kind, p_ref_id);
    select * into v_card from public.approvals
    where ref_kind = p_ref_kind and ref_id = p_ref_id and status in ('waiting', 'held') and user_id = v_user
    for update;
    if v_card.id is null then
      raise exception 'This draft has no card to show.' using errcode = 'P0002';
    end if;
  end if;

  if v_card.status = 'held' then
    perform public.card_budget_take(v_user, true);
    update public.approvals set status = 'waiting', held_until = null, released_at = now() where id = v_card.id;
  end if;
  return v_card.id;
end;
$$;
revoke all on function public.approval_show_now(text, uuid) from public, anon;
grant execute on function public.approval_show_now(text, uuid) to authenticated;

commit;
