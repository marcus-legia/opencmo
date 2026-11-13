-- Long posts (owner, 2026-11-12, daily core drafts D5 and D6).
--
-- A Threads post over 500 characters goes out as a chain, cut by code. A chain is a thread, and a thread never goes
-- out on autopilot (the rule of 20270119010000, unchanged): such a post keeps its ordinary card. X takes a long post
-- as one post, so X autopilot is as it was, whatever the length.
--
-- A free X account refuses a post over 280 characters. Its failed card then offers "Post as a thread": the slot's
-- `as_thread` setting, which the founder turns on and approves on a new card like any other platform setting.

-- True when this post would be a Threads chain: over 500 characters, and Threads is where it goes, either as the
-- platform of its proposed slot or as one of the planner's targets.
create or replace function public.post_is_threads_chain(p_item uuid, p_snapshot jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select char_length(btrim(coalesce(p_snapshot->>'text', ''), E' \t\n\r')) > 500
    and (p_snapshot->'proposed'->>'platform' = 'threads'
      or public.platform_profile_id(p_snapshot->>'platform') = 'threads'
      or exists (select 1 from public.content_items c
                 where c.id = p_item and jsonb_typeof(c.body->'targets') = 'array' and c.body->'targets' ? 'threads'));
$$;

create or replace function public.approvals_autopilot() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'post' and new.status in ('waiting', 'held') then
    begin
      new.auto_at := public.post_autopilot_at(new.user_id, new.ref_kind, new.ref_id, new.snapshot);
      -- An edit raises a new card, so the length is asked again each time the words change.
      if new.auto_at is not null and public.post_is_threads_chain(new.ref_id, new.snapshot) then
        new.auto_at := null;
      end if;
    exception when others then
      -- The card matters more than its countdown: it is raised as an ordinary card.
      raise warning 'autopilot for card of % failed: %', new.ref_id, sqlerrm;
      new.auto_at := null;
    end;
  end if;
  return new;
end;
$$;

create or replace function public.schedule_options_merge(p_platform text, p_current jsonb, p_new jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text;
  v_value jsonb;
begin
  if p_new is null or jsonb_typeof(p_new) <> 'object' then
    raise exception 'The platform settings are malformed.' using errcode = '22023';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_new) loop
    if v_key not in ('privacy', 'allow_comment', 'allow_duet', 'allow_stitch', 'brand_organic', 'brand_content', 'ai_label',
                     'as_thread') then
      raise exception 'Unknown platform setting "%".', left(v_key, 40) using errcode = '22023';
    end if;
    if v_key = 'as_thread' then
      if p_platform <> 'x' then
        raise exception 'Posting as a thread is only for X.' using errcode = '22023';
      end if;
    elsif v_key <> 'ai_label' and p_platform <> 'tiktok' then
      raise exception 'That setting is only for TikTok.' using errcode = '22023';
    end if;
    if v_key = 'privacy' then
      if jsonb_typeof(v_value) <> 'string' or v_value #>> '{}' not in
         ('PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY') then
        raise exception 'Choose who can see it from TikTok''s list.' using errcode = '22023';
      end if;
    elsif jsonb_typeof(v_value) <> 'boolean' then
      raise exception 'A platform toggle is on or off.' using errcode = '22023';
    end if;
  end loop;
  return coalesce(p_current, '{}'::jsonb) || p_new;
end;
$$;

revoke all on function public.post_is_threads_chain(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.approvals_autopilot() from public, anon, authenticated;
