-- A post is published when its first platform posts (decision F1 of
-- docs/plans/cmo/2026-11-13-core-drafts-followups-plan.md). The other platforms keep their slots and post at their own
-- times; a failed one keeps its Retry card. "I posted it" on the post card still cancels every waiting slot.
--
-- This replaces "published when the last open slot is" (20270120070000, review fix 1), which left a post `approved`
-- for ever behind one ignored failure: `post_slots_open` and the trigger `schedule_slots_settle_post` go.

create or replace function public.publish_status(p_slot uuid, p_status text, p_external_id text DEFAULT NULL::text, p_url text DEFAULT NULL::text, p_error jsonb DEFAULT NULL::jsonb, p_zernio_account_id text DEFAULT NULL::text) RETURNS public.schedule_slots
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slot public.schedule_slots;
  v_d public.deliverables;
  v_url text := case when p_url ~ '^https://' and char_length(p_url) <= 500 then p_url end;
begin
  if char_length(p_external_id) > 200 then
    raise exception 'The post id is too long.' using errcode = '22023';
  end if;
  if p_slot is not null then
    select * into v_slot from public.schedule_slots where id = p_slot for update;
  elsif nullif(trim(coalesce(p_external_id, '')), '') is not null then
    select * into v_slot from public.schedule_slots where external_id = p_external_id order by updated_at desc limit 1 for update;
  end if;
  if v_slot.id is null then
    raise exception 'Slot not found.' using errcode = 'P0002';
  end if;
  if p_zernio_account_id is not null and not exists (select 1 from public.social_accounts
      where id = v_slot.account_id and zernio_account_id = p_zernio_account_id) then
    raise exception 'That post is not on this account.' using errcode = 'P0001';
  end if;
  if v_slot.status in ('published', 'cancelled') then
    return v_slot;
  end if;
  case p_status
    when 'publishing', 'accepted' then
      if v_slot.status in ('due', 'publishing') then
        update public.schedule_slots set status = 'publishing', external_id = coalesce(p_external_id, external_id),
          updated_at = now()
        where id = v_slot.id returning * into v_slot;
      end if;
    when 'published' then
      update public.schedule_slots
      set status = 'published', external_id = coalesce(p_external_id, external_id),
          external_url = coalesce(v_url, external_url), published_at = now(), lease_until = null, updated_at = now()
      where id = v_slot.id returning * into v_slot;
      -- Live: a Retry card left from an earlier failure is done with.
      perform public.approval_close('schedule_slot', v_slot.id, 'approved');
      select * into v_d from public.deliverables where id = v_slot.deliverable_id;
      if v_d.ref_kind = 'content_item' then
        -- The first platform to post makes the post published (F1); the flag tells `schedule_follow_content` that a
        -- slot posted, so the other platforms keep their slots.
        perform set_config('opencmo.slot_published', 'on', true);
        update public.content_items set status = 'published', published_at = coalesce(published_at, now()),
          external_url = coalesce(v_url, external_url), updated_at = now()
        where id = v_d.ref_id and status <> 'published';
        perform set_config('opencmo.slot_published', '', true);
      end if;
    when 'failed' then
      if v_slot.status <> 'failed' then
        if p_error is null or jsonb_typeof(p_error) <> 'object' or jsonb_typeof(p_error->'message') <> 'string' then
          raise exception 'Say why it failed.' using errcode = '22023';
        end if;
        update public.schedule_slots
        set status = 'failed', lease_until = null, updated_at = now(),
            error = jsonb_build_object('code', left(coalesce(p_error->>'code', 'failed'), 40),
              'message', left(p_error->>'message', 500), 'retryable', coalesce(p_error->'retryable', 'true'::jsonb))
        where id = v_slot.id returning * into v_slot;
        perform public.approval_raise(v_slot.user_id, 'schedule_slot', v_slot.id);
      end if;
    when 'intent' then
      if v_slot.status <> 'failed' then
        update public.schedule_slots
        set status = 'failed', mode = 'intent', account_id = null, lease_until = null, updated_at = now(),
            error = jsonb_build_object('code', 'no_account', 'retryable', true,
              'message', 'No connected ' || public.schedule_platform_label(v_slot.platform)
                || ' account: copy it and post it yourself, or connect the account and retry.')
        where id = v_slot.id returning * into v_slot;
        perform public.approval_raise(v_slot.user_id, 'schedule_slot', v_slot.id);
      end if;
    else
      raise exception 'Unknown post status.' using errcode = '22023';
  end case;
  return v_slot;
end;
$$;


create or replace function public.schedule_mark_posted(p_slot uuid) RETURNS public.approvals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_slot public.schedule_slots;
  v_d public.deliverables;
  v_row public.approvals;
begin
  select * into v_slot from public.schedule_slots where id = p_slot and user_id = v_user for update;
  if not found then
    raise exception 'Slot not found.' using errcode = 'P0002';
  end if;
  if v_slot.status <> 'published' then
    -- A post the founder posted themselves, or one we could not confirm that they checked is live.
    if not ((v_slot.mode = 'intent' and v_slot.status in ('failed', 'reminded'))
            or (v_slot.status = 'failed' and v_slot.error->>'code' = 'unconfirmed')) then
      raise exception 'Only a post you copy and post yourself can be marked as posted.' using errcode = 'P0001';
    end if;
    update public.schedule_slots
    set status = 'published', published_at = now(), lease_until = null, error = null, updated_at = now()
    where id = v_slot.id;
    perform public.approval_close('schedule_slot', v_slot.id, 'approved');
    select * into v_d from public.deliverables where id = v_slot.deliverable_id;
    if v_d.ref_kind = 'content_item' then
      -- One platform marked posted is the post published (F1); the other platforms keep their slots.
      perform set_config('opencmo.slot_published', 'on', true);
      update public.content_items set status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
      where id = v_d.ref_id and user_id = v_user and status <> 'published';
      perform set_config('opencmo.slot_published', '', true);
    end if;
  end if;
  select * into v_row from public.approvals
  where ref_kind = 'schedule_slot' and ref_id = v_slot.id order by created_at desc limit 1;
  return v_row;
end;
$$;


create or replace function public.schedule_follow_content() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deliverable uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  begin
    if new.status = 'approved' and new.department = 'video' and new.clip_id is not null then
      select id into v_deliverable from public.deliverables
      where ref_kind = 'clip' and ref_id = new.clip_id and kind in ('short', 'slideshow', 'video') and user_id = new.user_id;
      if v_deliverable is not null then
        perform public.schedule_propose(v_deliverable);
      end if;
    elsif new.status = 'published' and new.department = 'post'
          and coalesce(current_setting('opencmo.slot_published', true), '') <> 'on' then
      -- Posted by hand on the post card ("I posted it"): what still waits for its time is dropped with its card. A
      -- slot that posted sets the flag, and the other platforms keep theirs.
      update public.approvals a set status = 'cancelled', decided_at = now()
      from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
      where a.ref_kind = 'schedule_slot' and a.ref_id = s.id and a.status = 'waiting'
        and d.ref_kind = 'content_item' and d.ref_id = new.id and s.status in ('proposed', 'waiting');
      update public.schedule_slots s set status = 'cancelled', updated_at = now()
      from public.deliverables d
      where d.id = s.deliverable_id and d.ref_kind = 'content_item' and d.ref_id = new.id
        and s.status in ('proposed', 'waiting');
    end if;
  exception when others then
    raise warning 'schedule rule for content item % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;


create or replace function public.schedule_propose(p_deliverable uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    -- Every platform of the post's slot (Writer's old items: the one platform of their label). A post one platform
    -- already published (F1) still asks for a new time on the others; one posted by hand on its card does not.
    select array(select t from unnest(public.post_targets(c.id)) with ordinality as u(t, o)
                 where t in ('x', 'threads', 'linkedin', 'facebook') order by o)
      into v_platforms
    from public.content_items c where c.id = v_d.ref_id
      and (c.status = 'approved' or (c.status = 'published' and exists (select 1 from public.schedule_slots s
        where s.deliverable_id = v_d.id and s.status = 'published')));
  elsif v_d.kind = 'photo_post' and v_d.ref_kind = 'photo_post' then
    -- The founder's own photos (D7): every platform they picked, each from its connected account.
    select array(select p from unnest(platforms) p where p in ('tiktok', 'instagram', 'threads') order by p) into v_platforms
    from public.photo_posts where id = v_d.ref_id and user_id = v_d.user_id and status = 'scheduled';
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
        "brand_organic": false, "brand_content": false}'::jsonb else '{}'::jsonb end
      || case when v_platform = 'x' and exists (select 1 from public.schedule_slots o
                where o.deliverable_id = v_d.id and o.platform = 'x' and o.options->>'as_thread' = 'true')
           then '{"as_thread": true}'::jsonb else '{}'::jsonb end)
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


create or replace function public.schedule_take_proposal(p_d public.deliverables, p_platform text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_rules jsonb := public.schedule_rules();
  v_item public.content_items;
  v_p jsonb;
  v_at timestamptz;
  v_gap interval := make_interval(hours => (v_rules->>'minGapHours')::integer);
  v_slot public.schedule_slots;
  v_snapshot jsonb;
  v_id uuid;
  v_gone constant text := 'The time you approved is no longer free. Pick a new one.';
begin
  -- "I posted it" approves and marks the post posted at once: nothing is scheduled for it.
  if coalesce(current_setting('opencmo.posted_self', true), '') = 'on' then
    return 'none';
  end if;
  -- A rewrite for this platform was not on the post card (daily core drafts D4): the founder sees it on its own
  -- schedule card before it goes out, so this slot does not ride on the post's approval.
  if public.post_variant_text(p_d.ref_id, p_platform) is not null then
    return 'none';
  end if;
  -- The approved time is used once, for the post's first slot on the platform; a slot asked again later (missed,
  -- expired, a Retry past its window) gets a new time on a card, as before.
  if exists (select 1 from public.schedule_slots where deliverable_id = p_d.id and platform = p_platform) then
    return 'none';
  end if;
  select * into v_item from public.content_items where id = p_d.ref_id and user_id = p_d.user_id
    and (status = 'approved' or (status = 'published' and exists (select 1 from public.schedule_slots s
        where s.deliverable_id = p_d.id and s.status = 'published')));
  if not found then
    return 'none';
  end if;
  v_p := public.post_proposal_snapshot(v_item.body);
  if v_p is null or v_p->>'platform' is distinct from p_platform then
    return 'none';
  end if;
  v_at := (v_p->>'at')::timestamptz;
  if v_at < now() + interval '1 minute' then
    return 'The time you approved has passed. Pick a new one.';
  end if;
  -- The founder's own pick is kept next to another post (`schedule_change` keeps it too); the picked one is not.
  if (v_item.body->'proposed'->>'picked' is distinct from 'founder' and exists (select 1 from public.schedule_slots
        where user_id = p_d.user_id and platform = p_platform and deliverable_id <> p_d.id
          and status in ('proposed', 'waiting', 'due', 'reminded', 'publishing', 'published')
          and publish_at > v_at - v_gap and publish_at < v_at + v_gap))
     or public.schedule_day_count(p_d.user_id, p_platform, v_at, null)
        >= (v_rules->'platforms'->p_platform->>'dailyCap')::integer then
    return v_gone;
  end if;
  -- Copy and open was approved, but an account is connected now: the founder decides again with the account.
  if v_p->>'mode' = 'intent' and exists (select 1 from public.social_accounts
      where user_id = p_d.user_id and platform = p_platform and status = 'connected') then
    return 'You connected ' || public.schedule_platform_label(p_platform) || ' since you approved it. Check the time and the account.';
  end if;
  v_slot.user_id := p_d.user_id;
  v_slot.deliverable_id := p_d.id;
  v_slot.platform := p_platform;
  v_slot.mode := v_p->>'mode';
  v_slot.account_id := case when v_slot.mode = 'publish' then (v_p->>'account_id')::uuid end;
  v_slot.options := '{}'::jsonb;
  if v_slot.mode = 'publish' and not exists (select 1 from public.social_accounts
      where id = v_slot.account_id and user_id = p_d.user_id and platform = p_platform) then
    return 'Reconnect your ' || public.schedule_platform_label(p_platform) || ' account first.';
  end if;
  begin
    perform public.schedule_ready_check(v_slot);
  exception when others then
    -- Its own words ("Reconnect your Threads account first."): the card shows why, not a time that is taken.
    return left(sqlerrm, 300);
  end;
  begin
    insert into public.schedule_slots (user_id, deliverable_id, platform, account_id, mode, publish_at, jitter_seconds,
      window_ends_at, options, status)
    values (v_slot.user_id, v_slot.deliverable_id, p_platform, v_slot.account_id, v_slot.mode, v_at, public.schedule_jitter(),
      v_at + make_interval(mins => (v_rules->>'windowMinutes')::integer), v_slot.options, 'waiting')
    returning * into v_slot;
  exception when unique_violation then
    return v_gone;
  end;
  -- The approval the firing checks (`schedule_approval_holds`): the slot as it is now, decided with the post card.
  v_snapshot := public.approval_snapshot('schedule_slot', v_slot.id);
  insert into public.approvals (user_id, kind, department, ref_kind, ref_id, snapshot, content_hash, post_at, account,
    status, decided_at, decided_via)
  values (v_slot.user_id, 'schedule', 'schedule', 'schedule_slot', v_slot.id, v_snapshot, public.approval_hash(v_snapshot),
    v_at, left(v_snapshot->>'handle', 100), 'approved', now(),
    coalesce(nullif(current_setting('opencmo.decided_via', true), ''), 'app'))
  returning id into v_id;
  update public.schedule_slots set approval_id = v_id, updated_at = now() where id = v_slot.id;
  return 'taken';
end;
$$;

drop trigger if exists schedule_slots_settle_post on public.schedule_slots;
drop function if exists public.schedule_slots_settle_post();
drop function if exists public.post_slots_open(uuid, uuid);
