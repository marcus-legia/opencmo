-- Code review of cmo-review-2 (2026-11-09), R1 and R2.
--
-- R1: `studio_order_release_hold` (20270111020000) counts the usage a Studio order's hold paid for in the order's spend.
-- Shorts and slideshow orders are created with a budget of 0, so every one of them ended with "Over budget … of 0
-- credits". The hold is the order's allowance: taking it raises the order's budget to it, and only usage past the hold
-- is over budget.
--
-- R2: `cmo_post_myself` refused any body with a `thread` of 5 or more items, while the card treats only a valid thread
-- (`thread_valid`) as a thread. An invalid one got "I posted it" on the card and an error from the server.

begin;

create or replace function public.studio_order_hold(p_order_id uuid) returns integer
language plpgsql security definer
set search_path to 'public'
as $$
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
  if v_held < public.studio_plan_hold() then
    perform public.credit_hold(v_user, 'work_order', p_order_id, public.studio_plan_hold() - v_held, 'CMO video team hold');
  end if;
  update public.work_orders set budget_credits = public.studio_plan_hold(), updated_at = now()
  where id = p_order_id and budget_credits < public.studio_plan_hold();
  return greatest(v_held, public.studio_plan_hold());
end;
$$;
revoke all on function public.studio_order_hold(uuid) from public, anon;
grant execute on function public.studio_order_hold(uuid) to authenticated, service_role;

create or replace function public.cmo_post_myself(p_approval uuid, p_content_hash text, p_text text default null)
returns public.approvals
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_row public.approvals;
  v_item public.content_items;
  v_profile text;
begin
  select * into v_row from public.approvals
  where id = p_approval and user_id = v_user and kind = 'post' and ref_kind = 'content_item';
  if not found then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  select * into v_item from public.content_items where id = v_row.ref_id and user_id = v_user;
  if not found then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  -- The platform as `cmo_decide_post` reads it: a label without a post profile is an X post.
  v_profile := public.platform_profile_id(v_item.platform);
  if v_profile is null or public.platform_profile(v_profile)->>'kind' is distinct from 'post' then
    v_profile := 'x';
  end if;
  -- A thread is approved as written and scheduled from its card; the same rule as the card (`thread_valid`).
  if public.thread_valid(v_item.body) then
    raise exception 'A thread is approved and scheduled from its card.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.social_accounts where user_id = v_user and platform = v_profile and status = 'connected') then
    raise exception 'This post goes out from your connected account. Approve it and pick its time instead.' using errcode = 'P0001';
  end if;

  perform public.approval_decide(p_approval, 'approve',
    jsonb_build_object('content_hash', p_content_hash, 'via', 'app')
      || case when nullif(trim(coalesce(p_text, '')), '') is null then '{}'::jsonb else jsonb_build_object('text', p_text) end);
  perform public.cmo_mark_posted(v_item.id);

  select * into v_row from public.approvals where id = p_approval;
  return v_row;
end;
$$;
revoke all on function public.cmo_post_myself(uuid, text, text) from public, anon;
grant execute on function public.cmo_post_myself(uuid, text, text) to authenticated;

commit;
