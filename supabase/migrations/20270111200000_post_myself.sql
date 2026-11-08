-- cmo-review-2 S2.6: "I posted it" on a post draft whose platform has no connected account. One transaction: approve the
-- draft as the card showed it (`approval_decide`: owner, hash, daily cap, outcome), then mark it posted
-- (`cmo_mark_posted`); the `schedule_follow_content` trigger cancels the slot and schedule card the approval proposed.
-- Two RPCs from the route could leave the post approved with its schedule card if the second failed (code review).

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
  -- A thread is approved as written and scheduled from its card.
  if jsonb_typeof(v_item.body->'thread') = 'array' and jsonb_array_length(v_item.body->'thread') >= 5 then
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
