-- cmo-review-3 1.2 (session A): one card for a post, its words and its time. When a post card is raised, the post
-- gets a proposed time (`body.proposed`: platform, time, account, mode), part of the card's snapshot and hash. Approving
-- it approves the time too: `schedule_propose` makes the slot `waiting` with an approval already given, and raises no
-- schedule card. When that time can no longer be used, it falls back to one schedule card that says so.

begin;

-- The time picked for a post card, or for a schedule card, also steers clear of the times other post cards still
-- propose, so two drafts waiting side by side do not both promise 09:00. `p_item` is the post asking (its own
-- proposal never blocks itself).
CREATE OR REPLACE FUNCTION public.schedule_pick_time(p_user uuid, p_platform text, p_deliverable uuid, p_item uuid) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_rules jsonb := public.schedule_rules();
  v_tz text := public.schedule_timezone(p_user);
  v_gap interval := make_interval(hours => (v_rules->>'minGapHours')::integer);
  v_earliest timestamptz := now() + make_interval(mins => (v_rules->>'leadMinutes')::integer);
  v_cap integer := (v_rules->'platforms'->p_platform->>'dailyCap')::integer;
  v_today date := (now() at time zone v_tz)::date;
  v_times text[] := public.schedule_candidate_times(p_user, p_platform);
  v_parent uuid;
  v_day integer;
  v_time text;
  v_at timestamptz;
begin
  if v_cap is null then
    return null;
  end if;
  select c.parent_clip_id into v_parent
  from public.deliverables d join public.clips c on c.id = d.ref_id
  where d.id = p_deliverable and d.ref_kind = 'clip';
  for v_day in 0 .. (v_rules->>'horizonDays')::integer loop
    foreach v_time in array v_times loop
      v_at := ((v_today + v_day) + v_time::time) at time zone v_tz;
      continue when v_at < v_earliest;
      continue when exists (select 1 from public.schedule_slots
        where user_id = p_user and platform = p_platform
          and status in ('proposed', 'waiting', 'due', 'reminded', 'publishing', 'published')
          and publish_at > v_at - v_gap and publish_at < v_at + v_gap);
      continue when exists (select 1 from public.content_items c
        where c.user_id = p_user and c.department = 'post' and c.status = 'in_review'
          and c.id is distinct from p_item and c.body->'proposed'->>'platform' = p_platform
          and public.post_proposed_at(c.body) > v_at - v_gap and public.post_proposed_at(c.body) < v_at + v_gap);
      continue when public.schedule_day_count(p_user, p_platform, v_at, null) >= v_cap;
      continue when v_parent is not null and exists (select 1 from public.schedule_slots s
        join public.deliverables d on d.id = s.deliverable_id
        where s.user_id = p_user and s.platform = p_platform and d.ref_kind = 'clip' and d.ref_id = v_parent
          and s.status in ('proposed', 'waiting', 'due', 'reminded', 'publishing', 'published')
          and (s.publish_at at time zone v_tz)::date = (v_at at time zone v_tz)::date);
      return v_at;
    end loop;
  end loop;
  return null;
end;
$$;

-- The proposed time of a post, or null when the body holds none (or a malformed one).
CREATE OR REPLACE FUNCTION public.post_proposed_at(p_body jsonb) RETURNS timestamp with time zone
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
begin
  if jsonb_typeof(p_body->'proposed') is distinct from 'object'
     or coalesce(p_body->'proposed'->>'at', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' then
    return null;
  end if;
  return (p_body->'proposed'->>'at')::timestamptz;
end;
$$;

CREATE OR REPLACE FUNCTION public.schedule_pick_time(p_user uuid, p_platform text, p_deliverable uuid) RETURNS timestamp with time zone
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select public.schedule_pick_time(p_user, p_platform, p_deliverable, null::uuid) $$;

-- What a post card proposes: the platform's slot id, the first free time, the connected account with its handle, and
-- the mode (copy and open without one). Null for a platform Schedule does not post to, or when no time is free in the
-- horizon. The handle is kept on the proposal: the card's hash must not move when the account row does.
CREATE OR REPLACE FUNCTION public.post_proposal(p_user uuid, p_platform_label text, p_item uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_platform text := public.platform_profile_id(p_platform_label);
  v_at timestamptz;
  v_account public.social_accounts;
begin
  -- The same platforms `schedule_propose` gives a slot to.
  if v_platform is null or v_platform not in ('x', 'threads', 'linkedin') then
    return null;
  end if;
  v_at := public.schedule_pick_time(p_user, v_platform, null, p_item);
  if v_at is null then
    return null;
  end if;
  select * into v_account from public.social_accounts
  where user_id = p_user and platform = v_platform and status = 'connected'
  order by connected_at, id limit 1;
  return jsonb_build_object('platform', v_platform,
    'at', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'account_id', v_account.id, 'handle', left(v_account.handle, 100),
    'mode', case when v_account.id is null then 'intent' else 'publish' end);
end;
$$;

-- Before the card is raised (`approvals_sync` runs after the row is written): a post entering review gets its time.
-- A post already in review keeps the time it shows, also when a redraft writes a whole new body; a body that sets
-- `proposed` to null drops it (the card then gets its time after approval, as before 1.2).
CREATE OR REPLACE FUNCTION public.content_items_post_proposal() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_proposed jsonb;
begin
  if new.department <> 'post' or new.status <> 'in_review' then
    return new;
  end if;
  -- Moved to another platform: the old platform's time and account no longer apply, so a new time is picked.
  if tg_op = 'UPDATE' and old.status = 'in_review' and new.platform is not distinct from old.platform then
    if new.body ? 'proposed' then
      if jsonb_typeof(new.body->'proposed') = 'null' then
        new.body := new.body - 'proposed';
      end if;
    elsif old.body ? 'proposed' then
      new.body := coalesce(new.body, '{}'::jsonb) || jsonb_build_object('proposed', old.body->'proposed');
    end if;
    return new;
  end if;
  begin
    v_proposed := public.post_proposal(new.user_id, new.platform, new.id);
  exception when others then
    -- A time is a convenience on the card; never a reason the draft cannot wait for the founder.
    raise warning 'post proposal for content item % failed: %', new.id, sqlerrm;
    v_proposed := null;
  end;
  new.body := coalesce(new.body, '{}'::jsonb) - 'proposed'
    || case when v_proposed is null then '{}'::jsonb else jsonb_build_object('proposed', v_proposed) end;
  return new;
end;
$$;

drop trigger if exists content_items_post_proposal on public.content_items;
create trigger content_items_post_proposal before insert or update of status, body, platform on public.content_items
  for each row execute function public.content_items_post_proposal();

-- The proposal as the card shows it: part of the snapshot, so the hash covers it. Read from the post alone (the handle
-- was stored with it), so a renamed or removed account does not lock the card; approving checks the account again.
CREATE OR REPLACE FUNCTION public.post_proposal_snapshot(p_body jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
declare
  v_p jsonb := p_body->'proposed';
  v_publish boolean := v_p->>'mode' = 'publish';
begin
  if public.post_proposed_at(p_body) is null or v_p->>'platform' not in ('x', 'threads', 'linkedin')
     or v_p->>'mode' not in ('publish', 'intent') then
    return null;
  end if;
  return jsonb_build_object('platform', v_p->>'platform', 'at', v_p->>'at',
    'account_id', case when v_publish then v_p->>'account_id' end, 'mode', v_p->>'mode',
    'handle', case when v_publish then left(v_p->>'handle', 100) end);
end;
$$;

-- `change_time` and `change_account` on a post card: the proposal changes, and the card is raised again with it (the
-- answer is the new card, as `schedule_change` answers). The same limits as a schedule card's time.
CREATE OR REPLACE FUNCTION public.post_change_proposal(p_card public.approvals, p_action text, p_payload jsonb) RETURNS public.approvals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_item public.content_items;
  v_rules jsonb := public.schedule_rules();
  v_p jsonb;
  v_at timestamptz;
  v_account public.social_accounts;
  v_row public.approvals;
begin
  select * into v_item from public.content_items
  where id = p_card.ref_id and user_id = p_card.user_id and department = 'post' for update;
  if not found or v_item.status <> 'in_review' then
    raise exception 'This post was already decided.' using errcode = 'P0001';
  end if;
  if public.post_proposal_snapshot(v_item.body) is null then
    raise exception 'This post gets its time after you approve it.' using errcode = 'P0001';
  end if;
  v_p := v_item.body->'proposed';
  if p_action = 'change_time' then
    begin
      v_at := (p_payload->>'publish_at')::timestamptz;
    exception when others then
      v_at := null;
    end;
    if v_at is null or p_payload->>'publish_at' !~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
      raise exception 'Pick a time, with its time zone.' using errcode = '22023';
    end if;
    if v_at < now() + interval '5 minutes' or v_at > now() + interval '60 days' then
      raise exception 'Pick a time between five minutes and 60 days from now.' using errcode = '22023';
    end if;
    if public.schedule_day_count(v_item.user_id, v_p->>'platform', v_at, null)
       >= (v_rules->'platforms'->(v_p->>'platform')->>'dailyCap')::integer then
      raise exception 'That day already has % posts on %.', (v_rules->'platforms'->(v_p->>'platform')->>'dailyCap'),
        public.schedule_platform_label(v_p->>'platform') using errcode = 'P0001';
    end if;
    -- Picked by the founder: kept even next to another post, as a schedule card's moved time is (`picked`).
    v_p := v_p || jsonb_build_object('at', to_char(date_trunc('second', v_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'picked', 'founder');
  else
    if p_payload->>'account_id' is null then
      v_p := v_p || '{"account_id": null, "handle": null, "mode": "intent"}'::jsonb;
    else
      select * into v_account from public.social_accounts
      where id::text = p_payload->>'account_id' and user_id = v_item.user_id and platform = v_p->>'platform' and status = 'connected';
      if not found then
        raise exception 'Choose one of your connected % accounts.', public.schedule_platform_label(v_p->>'platform')
          using errcode = '22023';
      end if;
      v_p := v_p || jsonb_build_object('account_id', v_account.id, 'handle', left(v_account.handle, 100), 'mode', 'publish');
    end if;
  end if;
  -- `approvals_sync` raises the card again for the changed body; the old one is superseded.
  update public.content_items set body = jsonb_set(body, '{proposed}', v_p), updated_at = now() where id = v_item.id;
  select * into v_row from public.approvals
  where ref_kind = 'content_item' and ref_id = v_item.id and status in ('waiting', 'held')
  order by created_at desc limit 1;
  return v_row;
end;
$_$;

-- An approved post whose card showed a time: the slot is made `waiting` at that time, with the founder's approval
-- recorded on it (the post card was the decision, so no schedule card is raised). Answers 'taken', 'none' (no
-- proposal to use: the caller proposes as before 1.2), or the reason the approved time cannot be used, which the
-- caller's schedule card shows.
CREATE OR REPLACE FUNCTION public.schedule_take_proposal(p_d public.deliverables, p_platform text) RETURNS text
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
  -- The approved time is used once, for the post's first slot on the platform; a slot asked again later (missed,
  -- expired, a Retry past its window) gets a new time on a card, as before.
  if exists (select 1 from public.schedule_slots where deliverable_id = p_d.id and platform = p_platform) then
    return 'none';
  end if;
  select * into v_item from public.content_items where id = p_d.ref_id and user_id = p_d.user_id and status = 'approved';
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

revoke all on function public.schedule_pick_time(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.post_proposed_at(jsonb) from public, anon, authenticated;
revoke all on function public.post_proposal(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.content_items_post_proposal() from public, anon, authenticated;
revoke all on function public.post_proposal_snapshot(jsonb) from public, anon, authenticated;
revoke all on function public.post_change_proposal(public.approvals, text, jsonb) from public, anon, authenticated;
revoke all on function public.schedule_take_proposal(public.deliverables, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.approval_snapshot(p_ref_kind text, p_ref_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v jsonb;
  v_look public.look_checks;
  v_extra jsonb;
begin
  -- The week plan card (cmo-review B2.1): the week's calendar as the brain planned it. Status stays out, so drafting a
  -- post does not change the card the founder is reading; an item they drop leaves it.
  if p_ref_kind = 'work_order' then
    -- A script the founder records (owner, 2026-11-09): the card of the `script` kind, free, read from the brief.
    select case when o.kind = 'write_video_brief' then jsonb_build_object('kind', 'script', 'step_id', o.id, 'clip_id', '',
        'tool', 'script_item', 'title', left(coalesce(o.brief->>'objective', o.title), 200),
        'seconds', o.brief->'seconds', 'aspect', o.brief->'aspect', 'price_credits', 0,
        'beats', coalesce((select jsonb_agg(jsonb_build_object('words', left(b->>'say', 300),
            'picture', left(case b->>'shot' when 'talking_head' then 'To camera: ' when 'screen' then 'Screen: ' else 'You film: ' end
              || coalesce(b->>'show', ''), 300), 'motion', null) order by n)
          from jsonb_array_elements(o.brief->'storyboard') with ordinality as s(b, n)), '[]'::jsonb)) end
    into v from public.work_orders o where o.id = p_ref_id;
    if v is not null then
      return v;
    end if;
    return public.plan_snapshot(p_ref_id);
  end if;
  v := public.approval_snapshot_base(p_ref_kind, p_ref_id);
  if v is null then
    return v;
  end if;
  if p_ref_kind = 'content_item' then
    -- A thread (P6 W4) and the time the post goes out (cmo-review-3 1.2): both are what the founder approves.
    select coalesce(case when public.thread_valid(c.body) then jsonb_build_object('thread', c.body->'thread') end, '{}'::jsonb)
        || case when p.proposed is null then '{}'::jsonb else jsonb_build_object('proposed', p.proposed) end
      into v_extra
    from public.content_items c cross join lateral (select public.post_proposal_snapshot(c.body) as proposed) p
    where c.id = p_ref_id;
    return v || coalesce(v_extra, '{}'::jsonb);
  end if;
  if p_ref_kind = 'opportunity' then
    select case when platform <> 'reddit' then jsonb_build_object('platform', platform) end into v_extra
    from public.opportunities where id = p_ref_id;
    return v || coalesce(v_extra, '{}'::jsonb);
  end if;
  if p_ref_kind not in ('editor_project', 'short_batch', 'studio_step') then
    return v;
  end if;
  select * into v_look from public.look_checks c
  where c.ref_kind = p_ref_kind and c.ref_id = p_ref_id and c.status = 'failed'
    and c.doc_key = coalesce(v->>'document_hash', v->>'parent_hash')
  order by c.round desc, c.created_at desc limit 1;
  if found and coalesce(v_look.result->>'note', '') <> '' then
    v := v || jsonb_build_object('look', jsonb_build_object('pass', false, 'round', v_look.round,
      'note', left(v_look.result->>'note', 200)));
  end if;
  return v;
end;
$$;


CREATE OR REPLACE FUNCTION public.approval_decide(p_id uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS public.approvals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_user uuid := public.require_user();
  v_row public.approvals;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_via text := coalesce(nullif(v_payload->>'via', ''), 'app');
  v_target integer;
  v_step public.studio_steps;
  v_batch public.short_batches;
  v_order uuid;
  v_n integer;
  v_text text;
  v_reason text := left(nullif(trim(coalesce(v_payload->>'reason', '')), ''), 400);
  v_caption public.content_items;
  v_title text;
  v_slot public.schedule_slots;
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'The decision is malformed.' using errcode = '22023';
  end if;
  if v_via not in ('app', 'mcp') then
    raise exception 'Cards are decided in the app or through MCP.' using errcode = '22023';
  end if;
  select * into v_row from public.approvals where id = p_id and user_id = v_user for update;
  if not found then
    raise exception 'Card not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'waiting' then
    raise exception 'This card was already decided.' using errcode = 'P0001';
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'This card expired. A new one will ask again.' using errcode = 'P0001';
  end if;
  if v_payload->>'content_hash' is distinct from v_row.content_hash
     or public.approval_hash(public.approval_snapshot(v_row.ref_kind, v_row.ref_id)) is distinct from v_row.content_hash then
    raise exception 'This card changed. Look at it again before deciding.' using errcode = 'P0001';
  end if;

  -- Words on a finished video or a shorts batch: one caption changes, nothing is decided.
  if p_action = 'edit_caption' then
    if v_row.kind not in ('finished_video', 'shorts_batch', 'slideshow') then
      raise exception 'Only a video''s, a batch''s or a slideshow''s captions are edited here.' using errcode = '22023';
    end if;
    if coalesce(v_payload->>'caption', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Say which caption to change.' using errcode = '22023';
    end if;
    select * into v_caption from public.content_items
    where id = (v_payload->>'caption')::uuid and user_id = v_user and department = 'video' and clip_id is not null
      and v_row.snapshot->'captions' @> jsonb_build_array(jsonb_build_object('caption_id', (v_payload->>'caption')))
    for update;
    if not found then
      raise exception 'That caption is not on this card.' using errcode = '22023';
    end if;
    v_text := trim(coalesce(v_payload->>'text', ''));
    v_title := case when v_caption.platform = 'youtube' then nullif(trim(coalesce(v_payload->>'title', v_caption.body->>'title', '')), '') end;
    perform public.caption_check(v_caption.platform, v_text, v_title);
    update public.content_items
    set body = jsonb_strip_nulls(body || jsonb_build_object('text', v_text, 'title', v_title, 'edited_at', now())),
        updated_at = now()
    where id = v_caption.id;
    perform public.approval_refresh(v_row.ref_kind, v_row.ref_id);
    select * into v_row from public.approvals where id = p_id;
    return v_row;
  end if;

  perform set_config('opencmo.decided_via', v_via, true);
  -- The week plan card (cmo-review B2.1) has its own function: it drops items and closes, nothing else runs.
  if v_row.kind = 'plan' then
    perform public.plan_card_decide(v_row, p_action, v_payload);
    perform set_config('opencmo.decided_via', '', true);
    select * into v_row from public.approvals where id = p_id;
    if v_reason is not null and v_row.status = 'skipped' then
      update public.approvals set reason = v_reason where id = p_id returning * into v_row;
    end if;
    return v_row;
  end if;
  case v_row.kind
    when 'post' then
      -- The time and account the card shows change through the post's proposal, which raises the card again; the
      -- answer is the new card, so the founder approves what they now see (cmo-review-3 1.2).
      if p_action in ('change_time', 'change_account') then
        perform set_config('opencmo.decided_via', '', true);
        return public.post_change_proposal(v_row, p_action, v_payload);
      end if;
      if p_action not in ('approve', 'skip') then
        raise exception 'Choose approve or skip.' using errcode = '22023';
      end if;
      perform public.cmo_decide_post(v_row.ref_id, p_action, v_payload->>'text', v_payload->>'reason');
    when 'reply' then
      if p_action not in ('replied', 'dismissed') then
        raise exception 'Choose replied or dismissed.' using errcode = '22023';
      end if;
      perform public.cmo_decide_opportunity(v_row.ref_id, p_action, v_payload->>'reason', v_payload->>'text');
    when 'goal' then
      if p_action not in ('approve', 'reject') then
        raise exception 'Choose approve or reject.' using errcode = '22023';
      end if;
      if v_payload ? 'target' then
        if jsonb_typeof(v_payload->'target') <> 'number'
           or (v_payload->>'target')::numeric <> trunc((v_payload->>'target')::numeric) then
          raise exception 'The target must be a whole number.' using errcode = '22023';
        end if;
        v_target := (v_payload->>'target')::numeric::integer;
      end if;
      perform public.cmo_decide_goal(v_row.ref_id, p_action, v_payload->>'goal', v_target);
    when 'correction' then
      perform public.cmo_decide_correction(v_row.ref_id, p_action, v_payload->>'text');
    when 'script', 'price' then
      if v_row.ref_kind = 'work_order' then
        if p_action not in ('approve', 'edit', 'cancel') then
          raise exception 'Choose approve, edit a beat or cancel.' using errcode = '22023';
        end if;
        if p_action = 'edit' then
          select b.beat, b.words into v_n, v_text from public.approval_script_beat(v_row.snapshot->'beats', v_payload) b;
          -- The founder's words are the script they record: kept on the order, the card closes as edited.
          update public.work_orders set brief = jsonb_set(brief, array['storyboard', v_n::text, 'say'], to_jsonb(v_text)),
            updated_at = now()
          where id = v_row.ref_id and user_id = v_user;
          perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'edited');
        else
          perform public.approval_close(v_row.ref_kind, v_row.ref_id, case p_action when 'cancel' then 'skipped' else 'approved' end);
        end if;
        -- The calendar item: approved, the founder records it; cancelled, it is skipped.
        update public.content_items c set status = case p_action when 'cancel' then 'skipped' else 'approved' end,
          decided_at = now(), updated_at = now()
        from public.work_orders o
        where o.id = v_row.ref_id and c.id = o.item_id and c.user_id = v_user and c.status in ('planned', 'drafting', 'in_review');
      else
      if (v_row.kind = 'script' and p_action not in ('approve', 'edit', 'cancel'))
         or (v_row.kind = 'price' and p_action not in ('approve', 'redo', 'cancel')) then
        raise exception '%', case v_row.kind when 'script' then 'Choose approve, edit a beat or cancel.'
          else 'Choose approve, redo a keyframe or cancel.' end using errcode = '22023';
      end if;
      select * into v_step from public.studio_steps where id = v_row.ref_id and user_id = v_user and kind in ('script', 'price') for update;
      if not found or v_step.status <> 'waiting' then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'edit' then
        select b.beat, b.words into v_n, v_text from public.approval_script_beat(v_row.snapshot->'beats', v_payload) b;
        -- The order runner plans the storyboard again with these words (`next`, added in 20261228120000): queued
        -- like any other Studio step, so it waits while the founder's CMO is paused and is retried.
        update public.studio_steps set status = 'cancelled', decision = 'edit', decided_at = now(),
          decision_payload = jsonb_build_object('beat', v_n, 'text', v_text),
          next = '{"tool": "replan"}'::jsonb, next_done_at = null
        where id = v_step.id;
      elsif p_action = 'redo' then
        if jsonb_typeof(v_payload->'index') is distinct from 'number'
           or (v_payload->>'index')::numeric <> trunc((v_payload->>'index')::numeric) then
          raise exception 'Say which keyframe to make again.' using errcode = '22023';
        end if;
        v_n := (v_payload->>'index')::numeric::integer;
        if not exists (select 1 from jsonb_array_elements(v_row.snapshot->'keyframes') k
                       where jsonb_typeof(k->'index') = 'number' and (k->>'index')::numeric = v_n) then
          raise exception 'That keyframe is not on the sheet.' using errcode = '22023';
        end if;
        update public.studio_steps set status = 'approved', decision = 'redo', decided_at = now(),
          decision_payload = jsonb_build_object('index', v_n)
        where id = v_step.id;
      elsif p_action = 'cancel' then
        update public.studio_steps set status = 'cancelled', decision = 'cancel', decided_at = now() where id = v_step.id;
        if v_step.order_id is not null and exists (select 1 from public.work_orders
            where id = v_step.order_id and status not in ('done', 'failed', 'cancelled')) then
          perform public.work_order_move(v_step.order_id, 'cancelled', 'You cancelled the video');
        end if;
      else
        update public.studio_steps set status = 'approved', decision = 'approve', decided_at = now() where id = v_step.id;
      end if;
      end if;
    when 'finished_video' then
      if p_action not in ('approve', 'send_back') then
        raise exception 'Choose approve or send back.' using errcode = '22023';
      end if;
      if p_action = 'approve' then
        -- Closes the card and finishes a video order making this edit (mark_finished owns both).
        perform public.mark_finished(v_row.ref_id, v_row.snapshot->>'document_hash');
      else
        perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'skipped');
        -- A failure is data: the order fails with the founder's reason and the progress check replans it.
        select s.order_id into v_order from public.studio_steps s join public.work_orders o on o.id = s.order_id
        where s.clip_id = v_row.ref_id and o.kind = 'build_video' and o.status not in ('done', 'failed', 'cancelled')
        order by s.created_at desc limit 1;
        if v_order is not null then
          perform public.work_order_move(v_order, 'failed', null, jsonb_build_object('code', 'sent_back',
            'message', coalesce(v_reason, 'The founder sent the video back.'), 'retryable', true,
            'repair_hint', 'Change what the founder asked, then render the video again.'));
        end if;
        -- The founder's own video: they change it in the editor and mark it finished again (a new order).
        for v_order in
          select id from public.work_orders where user_id = v_user and kind = 'post_video'
            and brief->>'clip_id' = v_row.ref_id::text and status not in ('done', 'failed', 'cancelled')
        loop
          perform public.work_order_move(v_order, 'cancelled', 'You sent the video back');
        end loop;
      end if;
    when 'shorts_batch' then
      if p_action not in ('approve', 'send_back') then
        raise exception 'Choose approve or send back.' using errcode = '22023';
      end if;
      select * into v_batch from public.short_batches where id = v_row.ref_id and user_id = v_user for update;
      if not found or v_batch.status <> 'waiting_founder' then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'approve' then
        update public.short_batches set status = 'approved', decided_at = now() where id = v_batch.id;
        update public.shorts set status = 'approved' where batch_id = v_batch.id and status = 'ready';
        -- Each short is its own deliverable, ready for Schedule (P4).
        if v_batch.order_id is not null then
          insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
          select v_user, v_batch.order_id, 'short', 'clip', s.short_clip_id, 'ready'
          from public.shorts s where s.batch_id = v_batch.id and s.status = 'approved' and s.short_clip_id is not null
          on conflict (ref_kind, ref_id) do nothing;
          if exists (select 1 from public.work_orders where id = v_batch.order_id and status not in ('done', 'failed', 'cancelled')) then
            perform public.work_order_move(v_batch.order_id, 'done', 'Shorts approved');
          end if;
        end if;
        perform public.approval_close('short_batch', v_batch.id, 'approved');
      else
        update public.short_batches set status = 'sent_back', decided_at = now() where id = v_batch.id;
        update public.shorts set status = 'sent_back' where batch_id = v_batch.id and status = 'ready';
        -- A failure is data: the replan reads the reason and may not cut the same shorts again (brain.md §6).
        if v_batch.order_id is not null and exists (select 1 from public.work_orders
            where id = v_batch.order_id and status not in ('done', 'failed', 'cancelled')) then
          perform public.work_order_move(v_batch.order_id, 'failed', null, jsonb_build_object('code', 'sent_back',
            'message', coalesce(v_reason, 'The founder sent the shorts back.'), 'retryable', true,
            'repair_hint', 'Cut different ranges from the same finished edit.'));
        end if;
        perform public.approval_close('short_batch', v_batch.id, 'skipped');
      end if;
    when 'slideshow' then
      -- Rendered before the card was raised, so approving runs nothing: the step and its order finish here and the
      -- MP4 becomes the slideshow deliverable Schedule picks up (A3). Text edits happen in the Slides view, which
      -- changes the document and raises a new card.
      if p_action not in ('approve', 'send_back') then
        raise exception 'Choose approve or send back.' using errcode = '22023';
      end if;
      select * into v_step from public.studio_steps where id = v_row.ref_id and user_id = v_user and kind = 'slideshow' for update;
      if not found or v_step.status <> 'waiting' then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'approve' then
        update public.studio_steps set status = 'done', decision = 'approve', decided_at = now() where id = v_step.id;
        if v_step.order_id is not null then
          insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
          values (v_user, v_step.order_id, 'slideshow', 'clip', v_step.clip_id, 'ready')
          on conflict (ref_kind, ref_id) do nothing;
          if exists (select 1 from public.work_orders where id = v_step.order_id and status not in ('done', 'failed', 'cancelled')) then
            perform public.work_order_move(v_step.order_id, 'done', 'Slideshow approved');
          end if;
        end if;
      else
        update public.studio_steps set status = 'cancelled', decision = 'cancel', decided_at = now() where id = v_step.id;
        -- A failure is data: the order fails with the founder's reason and the progress check replans it.
        if v_step.order_id is not null and exists (select 1 from public.work_orders
            where id = v_step.order_id and status not in ('done', 'failed', 'cancelled')) then
          perform public.work_order_move(v_step.order_id, 'failed', null, jsonb_build_object('code', 'sent_back',
            'message', coalesce(v_reason, 'The founder sent the slideshow back.'), 'retryable', true,
            'repair_hint', 'Change what the founder asked, then build the slideshow again.'));
        end if;
      end if;
    when 'schedule' then
      -- Time, account and platform fields change through schedule_change, which raises the card again; the
      -- answer is the new card, so the founder looks at what they now approve.
      if p_action in ('change_time', 'change_account', 'set_options') then
        perform set_config('opencmo.decided_via', '', true);
        return public.schedule_change(v_row.ref_id, p_action, v_payload);
      end if;
      if p_action not in ('approve', 'retry', 'cancel') then
        raise exception 'Choose approve, change the time or account, or cancel.' using errcode = '22023';
      end if;
      select * into v_slot from public.schedule_slots where id = v_row.ref_id and user_id = v_user for update;
      if not found or v_slot.status not in ('proposed', 'failed') then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'cancel' then
        update public.schedule_slots set status = 'cancelled', updated_at = now() where id = v_slot.id;
        perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'skipped');
      elsif v_slot.status = 'failed' and now() >= v_slot.window_ends_at then
        -- Too late for this time: never post late. The founder's Retry asks for a new time instead.
        perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'approved');
        perform public.schedule_propose(v_slot.deliverable_id);
      else
        if p_action = 'retry' and v_slot.status <> 'failed' then
          raise exception 'There is nothing to retry.' using errcode = '22023';
        end if;
        perform public.schedule_ready_check(v_slot);
        begin
          update public.schedule_slots set status = 'waiting', updated_at = now() where id = v_slot.id;
        exception when unique_violation then
          raise exception 'This post already has another time on %.', public.schedule_platform_label(v_slot.platform)
            using errcode = 'P0001';
        end;
        perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'approved');
      end if;
    else
      raise exception 'This card cannot be decided yet.' using errcode = 'P0001';
  end case;
  perform set_config('opencmo.decided_via', '', true);

  select * into v_row from public.approvals where id = p_id;
  if v_reason is not null and v_row.status in ('skipped', 'edited') then
    update public.approvals set reason = v_reason where id = p_id returning * into v_row;
  end if;
  return v_row;
end;
$_$;


CREATE OR REPLACE FUNCTION public.schedule_propose(p_deliverable uuid) RETURNS integer
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
    -- Writer stores the calendar's label ("X", "Threads", "LinkedIn"); slots use the platform's id.
    select array_agg(public.platform_profile_id(platform)) into v_platforms from public.content_items
    where id = v_d.ref_id and status = 'approved' and public.platform_profile_id(platform) in ('x', 'threads', 'linkedin');
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
    -- The post card carried its time (cmo-review-3 1.2): approving the post approved it, so no schedule card asks.
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


CREATE OR REPLACE FUNCTION public.cmo_post_myself(p_approval uuid, p_content_hash text, p_text text DEFAULT NULL::text) RETURNS public.approvals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

  -- Posted already: the time on the card is not used (`schedule_take_proposal` reads this).
  perform set_config('opencmo.posted_self', 'on', true);
  perform public.approval_decide(p_approval, 'approve',
    jsonb_build_object('content_hash', p_content_hash, 'via', 'app')
      || case when nullif(trim(coalesce(p_text, '')), '') is null then '{}'::jsonb else jsonb_build_object('text', p_text) end);
  perform set_config('opencmo.posted_self', '', true);
  perform public.cmo_mark_posted(v_item.id);

  select * into v_row from public.approvals where id = p_approval;
  return v_row;
end;
$$;


commit;
