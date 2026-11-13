-- One core post a slot, scheduled on every platform the planner picked (daily core drafts, owner 2026-11-12, D3, D6).
--
-- 1. `platform_profile` gains `core` (one post for several platforms) and X takes 25,000 characters (X Premium; a free
--    account's refusal is handled when it is published). The numbers match packages/contracts/platforms.json
--    (lib/cmo/platforms.check.ts compares them).
-- 2. `post_targets(item)`: the platforms a post goes to, the planner's `body.targets` when it has them, else its one
--    platform (posts made before the posting plan).
-- 3. `schedule_propose` gives an approved post one slot per target: `publish` with a connected account, else `intent`
--    (copy and open). The target the post card carried a time for takes that time; the others get a schedule card.
-- 4. `cmo_save_draft` keeps the planner's `targets` and `slot` when the draft replaces the item's body; before this a
--    drafted post lost its targets and went out on one platform only.
--
-- Redeclares functions of 20261229090000, 20270101103000 and 20270113010000; `create or replace` keeps their grants.

create or replace function public.platform_profile(p_id text) returns jsonb
language sql immutable set search_path = public
as $$
  select case p_id
    when 'x' then '{"kind": "post", "limit": 25000, "title": null, "hashtags": 0, "label": "X"}'::jsonb
    when 'threads' then '{"kind": "post", "limit": 500, "title": null, "hashtags": 0, "label": "Threads"}'::jsonb
    when 'linkedin' then '{"kind": "post", "limit": 3000, "title": null, "hashtags": 0, "label": "LinkedIn"}'::jsonb
    when 'core' then '{"kind": "core", "limit": 3000, "title": null, "hashtags": 0, "label": "Post"}'::jsonb
    when 'instagram_caption' then '{"kind": "caption", "limit": 2200, "title": null, "hashtags": 5, "label": "Instagram caption"}'::jsonb
    when 'tiktok_caption' then '{"kind": "caption", "limit": 2200, "title": null, "hashtags": 5, "label": "TikTok caption"}'::jsonb
    when 'youtube' then '{"kind": "youtube", "limit": 5000, "title": 100, "hashtags": 3, "label": "YouTube title and description"}'::jsonb
  end
$$;
revoke all on function public.platform_profile(text) from public, anon, authenticated;

-- The platforms a post goes to, in the planner's order. Null for an item that does not exist.
create or replace function public.post_targets(p_item uuid) returns text[]
language sql stable security definer set search_path = public
as $$
  select case
    when jsonb_typeof(c.body->'targets') = 'array' and jsonb_array_length(c.body->'targets') > 0
      then array(select t from jsonb_array_elements_text(c.body->'targets') with ordinality as u(t, o) order by o)
    else array_remove(array[public.platform_profile_id(c.platform)], null)
  end
  from public.content_items c where c.id = p_item
$$;
revoke all on function public.post_targets(uuid) from public, anon, authenticated;

-- As in 20270113010000, with one slot per target of a post.
create or replace function public.schedule_propose(p_deliverable uuid) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_d public.deliverables;
  v_rules jsonb := public.schedule_rules();
  v_platform text;
  v_platforms text[];
  v_at timestamptz;
  v_account uuid;
  v_slot uuid;
  v_n integer := 0;
  v_taken text;
begin
  select * into v_d from public.deliverables where id = p_deliverable;
  if not found then
    return 0;
  end if;
  if v_d.kind = 'post' and v_d.ref_kind = 'content_item' then
    -- Every platform of the post's slot (Writer's old items: the one platform of their label).
    select array(select t from unnest(public.post_targets(c.id)) with ordinality as u(t, o)
                 where t in ('x', 'threads', 'linkedin') order by o)
      into v_platforms
    from public.content_items c where c.id = v_d.ref_id and c.status = 'approved';
  elsif v_d.kind in ('short', 'slideshow', 'video') and v_d.ref_kind = 'clip' then
    select array_agg(p) into v_platforms from unnest(array['tiktok', 'instagram', 'youtube']) p
    where exists (select 1 from public.content_items c
      where c.clip_id = v_d.ref_id and c.department = 'video' and c.status = 'approved'
        and c.platform = public.platform_profile_id(p));
  end if;
  foreach v_platform in array coalesce(v_platforms, '{}') loop
    continue when exists (select 1 from public.schedule_slots where deliverable_id = v_d.id and platform = v_platform
      and status in ('proposed', 'waiting', 'due', 'reminded', 'publishing', 'published'));
    -- A failure still in its window waits on its Retry card; an unconfirmed one may have gone out. Neither gets a twin.
    continue when exists (select 1 from public.schedule_slots where deliverable_id = v_d.id and platform = v_platform
      and status = 'failed' and (window_ends_at > now() or error->>'code' = 'unconfirmed'));
    continue when (select count(*) from public.schedule_slots where deliverable_id = v_d.id and platform = v_platform)
      >= (v_rules->>'maxProposals')::integer;
    -- The post card carried its time (cmo-review-3 1.2) for its first platform: approving the post approved it, so no
    -- schedule card asks. The other targets get a card each.
    v_taken := 'none';
    if v_d.kind = 'post' then
      v_taken := public.schedule_take_proposal(v_d, v_platform);
      if v_taken = 'taken' then
        v_n := v_n + 1;
        continue;
      end if;
    end if;
    v_at := public.schedule_pick_time(v_d.user_id, v_platform, v_d.id);
    continue when v_at is null;
    v_account := null;
    select id into v_account from public.social_accounts
    where user_id = v_d.user_id and platform = v_platform and status = 'connected';
    -- TikTok's posting guidelines: the founder picks the audience and turns on each interaction and disclosure;
    -- nothing starts on.
    insert into public.schedule_slots (user_id, deliverable_id, platform, account_id, mode, publish_at, jitter_seconds,
      window_ends_at, options)
    values (v_d.user_id, v_d.id, v_platform, v_account, case when v_account is null then 'intent' else 'publish' end,
      v_at, public.schedule_jitter(), v_at + make_interval(mins => (v_rules->>'windowMinutes')::integer),
      case when v_platform = 'tiktok' then '{"allow_comment": false, "allow_duet": false, "allow_stitch": false,
        "brand_organic": false, "brand_content": false}'::jsonb else '{}'::jsonb end)
    returning id into v_slot;
    -- The time the founder approved cannot be used: the card says why, as a missed post's card does.
    if v_taken not in ('none', 'taken') then
      update public.schedule_slots set error = jsonb_build_object('code', 'missed', 'message', v_taken) where id = v_slot;
    end if;
    perform public.approval_raise(v_d.user_id, 'schedule_slot', v_slot);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- As in 20270101103000; the draft keeps the planner's targets and slot.
create or replace function public.cmo_save_draft(p_user uuid, p_run uuid, p_item uuid, p_idea text, p_body jsonb,
  p_priority text default 'medium', p_platform text default null)
returns public.content_items language plpgsql security definer set search_path = public
as $$
declare
  v_row public.content_items;
  v_profile jsonb := public.platform_profile(public.platform_profile_id(p_platform));
  v_post boolean := coalesce(v_profile->>'kind' = 'post', false);
  v_platform text := case when v_post then v_profile->>'label' else 'x' end;
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object' or coalesce(p_body->>'text', '') = '' then
    raise exception 'This draft is not valid.' using errcode = '22023';
  end if;
  if p_body ? 'thread' then
    if not public.thread_valid(p_body) then
      raise exception 'A thread has 5 to 8 posts of at most 280 characters, the first being the post.' using errcode = '22023';
    end if;
    if coalesce(public.platform_profile_id(case when p_item is not null
         then (select platform from public.content_items where id = p_item and user_id = p_user) else v_platform end), 'x') <> 'x' then
      raise exception 'Only an X post can be a thread.' using errcode = '22023';
    end if;
  end if;
  if p_item is not null then
    update public.content_items
    set status = 'in_review',
        body = (p_body - 'targets' - 'slot')
          || jsonb_strip_nulls(jsonb_build_object('targets', body->'targets', 'slot', body->'slot')),
        priority = coalesce(p_priority, 'medium'), run_id = p_run, updated_at = now()
    where id = p_item and user_id = p_user and status in ('planned', 'drafting')
    returning * into v_row;
    if not found then
      raise exception 'This calendar item is no longer open.' using errcode = 'P0002';
    end if;
  else
    insert into public.content_items (user_id, run_id, department, platform, day, idea, status, priority, body)
    values (p_user, p_run, 'post', v_platform, current_date,
            left(coalesce(nullif(p_idea, ''), 'Post for ' || case when v_post then v_profile->>'label' else 'X' end), 300),
            'in_review', coalesce(p_priority, 'medium'), p_body - 'targets' - 'slot')
    returning * into v_row;
  end if;
  return v_row;
end;
$$;
revoke all on function public.cmo_save_draft(uuid, uuid, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.cmo_save_draft(uuid, uuid, uuid, text, jsonb, text, text) to service_role;
