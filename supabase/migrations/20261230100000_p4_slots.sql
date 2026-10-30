-- 20261230100000: P4 A1, slots and schedule cards (docs/plans/cmo/2026-10-28-p4-schedule-publish-plan.md F3–F4,
-- schedule-publish.md §5, approval.md §5–§6).
--
-- An approved deliverable gets a proposed time per platform: the first default slot (packages/contracts/
-- schedule-defaults.json, from Buffer's 2026 study) in the founder's timezone that keeps three hours from other
-- posts on that platform, stays under the daily cap, and is not the same day as the short's own long video. The
-- founder approves the card, or changes the time, the account or the platform's fields (a new card supersedes the
-- old one, approved or not), or cancels. Nothing fires yet (A2).

begin;

-- The same object as schedule-defaults.json (minus $schema and $comment); schedule-defaults.check.ts compares them.
create or replace function public.schedule_rules() returns jsonb
language sql immutable set search_path = public
as $$ select '{"minGapHours": 3, "windowMinutes": 15, "leadMinutes": 30, "horizonDays": 14, "maxProposals": 3, "jitterSeconds": 240, "platforms": {"x": {"times": ["09:00"], "dailyCap": 5}, "threads": {"times": ["09:00", "12:00"], "dailyCap": 2}, "linkedin": {"times": ["16:00"], "dailyCap": 1}, "tiktok": {"times": ["09:00", "13:00"], "dailyCap": 2}, "instagram": {"times": ["09:00"], "dailyCap": 1}, "youtube": {"times": ["16:00", "19:00"], "dailyCap": 2}}}'::jsonb $$;
revoke all on function public.schedule_rules() from public, anon, authenticated;

create or replace function public.schedule_platform_label(p_platform text) returns text
language sql immutable set search_path = public
as $$
  select case p_platform when 'x' then 'X' when 'threads' then 'Threads' when 'linkedin' then 'LinkedIn'
    when 'tiktok' then 'TikTok' when 'instagram' then 'Instagram' when 'youtube' then 'YouTube' else p_platform end
$$;
revoke all on function public.schedule_platform_label(text) from public, anon, authenticated;

create or replace function public.schedule_timezone(p_user uuid) returns text
language sql stable security definer set search_path = public
as $$ select coalesce((select timezone from public.profiles where id = p_user), 'UTC') $$;
revoke all on function public.schedule_timezone(uuid) from public, anon, authenticated;

-- Live slots of one founder on one platform during the local day of `p_at`, not counting `p_except`.
create or replace function public.schedule_day_count(p_user uuid, p_platform text, p_at timestamptz, p_except uuid)
returns integer language sql stable security definer set search_path = public
as $$
  select count(*)::integer from public.schedule_slots
  where user_id = p_user and platform = p_platform and id is distinct from p_except
    and status in ('proposed', 'waiting', 'due', 'reminded', 'publishing', 'published')
    and (publish_at at time zone public.schedule_timezone(p_user))::date
      = (p_at at time zone public.schedule_timezone(p_user))::date
$$;
revoke all on function public.schedule_day_count(uuid, text, timestamptz, uuid) from public, anon, authenticated;

-- The first default slot that keeps the gap, the daily cap and the short-vs-its-long-video rule; null when none is
-- free within the horizon.
create or replace function public.schedule_pick_time(p_user uuid, p_platform text, p_deliverable uuid)
returns timestamptz language plpgsql stable security definer set search_path = public
as $$
declare
  v_rules jsonb := public.schedule_rules();
  v_tz text := public.schedule_timezone(p_user);
  v_gap interval := make_interval(hours => (v_rules->>'minGapHours')::integer);
  v_earliest timestamptz := now() + make_interval(mins => (v_rules->>'leadMinutes')::integer);
  v_cap integer := (v_rules->'platforms'->p_platform->>'dailyCap')::integer;
  v_today date := (now() at time zone v_tz)::date;
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
    for v_time in select jsonb_array_elements_text(v_rules->'platforms'->p_platform->'times') loop
      v_at := ((v_today + v_day) + v_time::time) at time zone v_tz;
      continue when v_at < v_earliest;
      continue when exists (select 1 from public.schedule_slots
        where user_id = p_user and platform = p_platform
          and status in ('proposed', 'waiting', 'due', 'reminded', 'publishing', 'published')
          and publish_at > v_at - v_gap and publish_at < v_at + v_gap);
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
revoke all on function public.schedule_pick_time(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.schedule_jitter() returns integer
language sql volatile set search_path = public
as $$ select (round((random() * 2 - 1) * (public.schedule_rules()->>'jitterSeconds')::integer))::integer $$;
revoke all on function public.schedule_jitter() from public, anon, authenticated;

-- Proposes a slot and raises its card on every platform the deliverable goes to: a post on its own platform, a
-- short on each platform it has an approved caption for. A platform that already has a live slot, or was proposed
-- maxProposals times, is left alone. Returns how many slots it proposed.
create or replace function public.schedule_propose(p_deliverable uuid)
returns integer language plpgsql volatile security definer set search_path = public
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
begin
  select * into v_d from public.deliverables where id = p_deliverable;
  if not found then
    return 0;
  end if;
  if v_d.kind = 'post' and v_d.ref_kind = 'content_item' then
    select array_agg(platform) into v_platforms from public.content_items
    where id = v_d.ref_id and status = 'approved' and platform in ('x', 'threads', 'linkedin');
  elsif v_d.kind = 'short' and v_d.ref_kind = 'clip' then
    select array_agg(p) into v_platforms from unnest(array['tiktok', 'instagram', 'youtube']) p
    where exists (select 1 from public.content_items c
      where c.clip_id = v_d.ref_id and c.department = 'video' and c.status = 'approved'
        and c.platform = public.platform_profile_id(p));
  end if;
  foreach v_platform in array coalesce(v_platforms, '{}') loop
    continue when exists (select 1 from public.schedule_slots where deliverable_id = v_d.id and platform = v_platform
      and status in ('proposed', 'waiting', 'due', 'reminded', 'publishing', 'published'));
    continue when (select count(*) from public.schedule_slots where deliverable_id = v_d.id and platform = v_platform)
      >= (v_rules->>'maxProposals')::integer;
    v_at := public.schedule_pick_time(v_d.user_id, v_platform, v_d.id);
    continue when v_at is null;
    select id into v_account from public.social_accounts
    where user_id = v_d.user_id and platform = v_platform and status = 'connected';
    insert into public.schedule_slots (user_id, deliverable_id, platform, account_id, mode, publish_at, jitter_seconds,
      window_ends_at)
    values (v_d.user_id, v_d.id, v_platform, v_account, case when v_account is null then 'intent' else 'publish' end,
      v_at, public.schedule_jitter(), v_at + make_interval(mins => (v_rules->>'windowMinutes')::integer))
    returning id into v_slot;
    perform public.approval_raise(v_d.user_id, 'schedule_slot', v_slot);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.schedule_propose(uuid) from public, anon, authenticated;

-- The platform fields the card may set, merged into the slot's: TikTok's privacy (one of its levels) and its
-- comment, duet and stitch toggles on TikTok only; the AI-generated label anywhere.
create or replace function public.schedule_options_merge(p_platform text, p_current jsonb, p_new jsonb)
returns jsonb language plpgsql immutable set search_path = public
as $$
declare
  v_key text;
  v_value jsonb;
begin
  if p_new is null or jsonb_typeof(p_new) <> 'object' then
    raise exception 'The platform settings are malformed.' using errcode = '22023';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_new) loop
    if v_key not in ('privacy', 'allow_comment', 'allow_duet', 'allow_stitch', 'ai_label') then
      raise exception 'Unknown platform setting "%".', left(v_key, 40) using errcode = '22023';
    end if;
    if v_key <> 'ai_label' and p_platform <> 'tiktok' then
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
revoke all on function public.schedule_options_merge(text, jsonb, jsonb) from public, anon, authenticated;

-- Before a slot may wait for its time: an account to post from, and on TikTok the fields its rules make the poster
-- choose (no default for a field the founder did not see).
create or replace function public.schedule_ready_check(p_slot public.schedule_slots)
returns void language plpgsql stable security definer set search_path = public
as $$
begin
  if p_slot.mode = 'intent' then
    if p_slot.platform in ('tiktok', 'instagram', 'youtube') then
      raise exception 'Connect your % account to post this.', public.schedule_platform_label(p_slot.platform)
        using errcode = 'P0001';
    end if;
    return;
  end if;
  if not exists (select 1 from public.social_accounts where id = p_slot.account_id and status = 'connected') then
    raise exception 'Reconnect your % account first.', public.schedule_platform_label(p_slot.platform) using errcode = 'P0001';
  end if;
  if p_slot.platform = 'tiktok' and (jsonb_typeof(p_slot.options->'privacy') is distinct from 'string'
     or jsonb_typeof(p_slot.options->'allow_comment') is distinct from 'boolean') then
    raise exception 'Choose who can see it on TikTok and whether people can comment.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.schedule_ready_check(public.schedule_slots) from public, anon, authenticated;

-- The founder changes a slot (on its card, or by dragging it on the calendar): a new time, another account, or the
-- platform's fields. The slot goes back to proposed and a new card supersedes the old one, approved or not, so
-- nothing posts on a decision the founder did not see. Returns the new card.
create or replace function public.schedule_change(p_slot uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns public.approvals language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_slot public.schedule_slots;
  v_rules jsonb := public.schedule_rules();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_at timestamptz;
  v_account public.social_accounts;
  v_row public.approvals;
begin
  select * into v_slot from public.schedule_slots where id = p_slot and user_id = v_user for update;
  if not found then
    raise exception 'Slot not found.' using errcode = 'P0002';
  end if;
  if v_slot.status not in ('proposed', 'waiting', 'failed') then
    raise exception 'This post is already on its way.' using errcode = 'P0001';
  end if;
  case p_action
    when 'change_time' then
      begin
        v_at := (v_payload->>'publish_at')::timestamptz;
      exception when others then
        v_at := null;
      end;
      if v_at is null or v_payload->>'publish_at' !~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
        raise exception 'Pick a time, with its time zone.' using errcode = '22023';
      end if;
      if v_at < now() + interval '5 minutes' or v_at > now() + interval '60 days' then
        raise exception 'Pick a time between five minutes and 60 days from now.' using errcode = '22023';
      end if;
      if public.schedule_day_count(v_user, v_slot.platform, v_at, v_slot.id)
         >= (v_rules->'platforms'->v_slot.platform->>'dailyCap')::integer then
        raise exception 'That day already has % posts on %.', (v_rules->'platforms'->v_slot.platform->>'dailyCap'),
          public.schedule_platform_label(v_slot.platform) using errcode = 'P0001';
      end if;
      v_slot.publish_at := v_at;
      v_slot.window_ends_at := v_at + make_interval(mins => (v_rules->>'windowMinutes')::integer);
      v_slot.jitter_seconds := public.schedule_jitter();
    when 'change_account' then
      if v_payload->>'account_id' is null then
        v_slot.account_id := null;
        v_slot.mode := 'intent';
      else
        select * into v_account from public.social_accounts
        where id::text = v_payload->>'account_id' and user_id = v_user and platform = v_slot.platform and status = 'connected';
        if not found then
          raise exception 'Choose one of your connected % accounts.', public.schedule_platform_label(v_slot.platform)
            using errcode = '22023';
        end if;
        v_slot.account_id := v_account.id;
        v_slot.mode := 'publish';
      end if;
    when 'set_options' then
      v_slot.options := public.schedule_options_merge(v_slot.platform, v_slot.options, v_payload->'options');
      if octet_length(v_slot.options::text) > 1024 then
        raise exception 'The platform settings are too long.' using errcode = '22023';
      end if;
    else
      raise exception 'Choose a new time, another account or the platform settings.' using errcode = '22023';
  end case;
  begin
    update public.schedule_slots
    set publish_at = v_slot.publish_at, window_ends_at = v_slot.window_ends_at, jitter_seconds = v_slot.jitter_seconds,
        account_id = v_slot.account_id, mode = v_slot.mode, options = v_slot.options,
        status = 'proposed', error = null, updated_at = now()
    where id = v_slot.id;
  exception when unique_violation then
    raise exception 'This post already has another time on %.', public.schedule_platform_label(v_slot.platform)
      using errcode = 'P0001';
  end;
  perform public.approval_raise(v_user, 'schedule_slot', v_slot.id);
  select * into v_row from public.approvals where ref_kind = 'schedule_slot' and ref_id = v_slot.id and status = 'waiting';
  return v_row;
end;
$$;
revoke all on function public.schedule_change(uuid, text, jsonb) from public, anon;
grant execute on function public.schedule_change(uuid, text, jsonb) to authenticated;

create or replace function public.approval_raise(p_user uuid, p_ref_kind text, p_ref_id uuid)
returns void language plpgsql volatile security definer set search_path = public
as $$
declare
  v_snapshot jsonb := public.approval_snapshot(p_ref_kind, p_ref_id);
  v_hash text;
  v_kind text;
  v_id uuid;
  v_expires timestamptz;
begin
  if v_snapshot is null then
    return;
  end if;
  v_hash := public.approval_hash(v_snapshot);
  if exists (select 1 from public.approvals
             where ref_kind = p_ref_kind and ref_id = p_ref_id and status = 'waiting' and content_hash = v_hash) then
    return;
  end if;
  update public.approvals set status = 'cancelled', decided_at = now()
  where ref_kind = p_ref_kind and ref_id = p_ref_id and status = 'waiting';
  v_kind := v_snapshot->>'kind';
  -- A failure card (it carries the last error) stays open while the slot's window lasts, so Retry can still post
  -- at the approved time; any other schedule card expires at its time.
  if v_kind = 'schedule' then
    select case when s.error is not null then s.window_ends_at else s.publish_at end into v_expires
    from public.schedule_slots s where s.id = p_ref_id;
  end if;
  -- A schedule card carries its time and account in the foot and expires when its time comes (rule 4).
  insert into public.approvals (user_id, kind, department, ref_kind, ref_id, snapshot, content_hash, price_credits,
    post_at, account, expires_at)
  values (p_user, v_kind,
    case v_kind when 'post' then 'writer' when 'reply' then 'sales'
      when 'script' then 'studio' when 'price' then 'studio' when 'finished_video' then 'studio'
      when 'shorts_batch' then 'studio' when 'schedule' then 'schedule' else 'brain' end,
    p_ref_kind, p_ref_id, v_snapshot, v_hash,
    case when v_kind in ('script', 'price') then (v_snapshot->>'price_credits')::integer end,
    case when v_kind = 'schedule' then (v_snapshot->>'publish_at')::timestamptz end,
    case when v_kind = 'schedule' then left(v_snapshot->>'handle', 100) end,
    v_expires)
  returning id into v_id;
  if v_kind = 'schedule' then
    update public.schedule_slots set approval_id = v_id, updated_at = now() where id = p_ref_id;
  end if;
end;
$$;
revoke all on function public.approval_raise(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.approval_decide(p_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns public.approvals language plpgsql volatile security definer set search_path = public
as $$
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
    if v_row.kind not in ('finished_video', 'shorts_batch') then
      raise exception 'Only a video''s or a batch''s captions are edited here.' using errcode = '22023';
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
  case v_row.kind
    when 'post' then
      if p_action not in ('approve', 'skip') then
        raise exception 'Choose approve or skip.' using errcode = '22023';
      end if;
      perform public.cmo_decide_post(v_row.ref_id, p_action, v_payload->>'text', v_payload->>'reason');
    when 'reply' then
      if p_action not in ('replied', 'dismissed') then
        raise exception 'Choose replied or dismissed.' using errcode = '22023';
      end if;
      perform public.cmo_decide_opportunity(v_row.ref_id, p_action, v_payload->>'reason');
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
      if (v_row.kind = 'script' and p_action not in ('approve', 'edit', 'cancel'))
         or (v_row.kind = 'price' and p_action not in ('approve', 'redo', 'cancel')) then
        raise exception '%', case v_row.kind when 'script' then 'Choose approve, edit a beat or cancel.'
          else 'Choose approve, redo a keyframe or cancel.' end using errcode = '22023';
      end if;
      select * into v_step from public.studio_steps where id = v_row.ref_id and user_id = v_user for update;
      if not found or v_step.status <> 'waiting' then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'edit' then
        if jsonb_typeof(v_payload->'beat') is distinct from 'number'
           or (v_payload->>'beat')::numeric <> trunc((v_payload->>'beat')::numeric) then
          raise exception 'Say which beat to change.' using errcode = '22023';
        end if;
        v_n := (v_payload->>'beat')::numeric::integer;
        v_text := trim(coalesce(v_payload->>'text', ''));
        if v_n < 0 or v_n >= jsonb_array_length(v_row.snapshot->'beats') then
          raise exception 'That beat is not in the script.' using errcode = '22023';
        end if;
        if char_length(v_text) not between 1 and 300 then
          raise exception 'A beat''s words are 1 to 300 characters.' using errcode = '22023';
        end if;
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
$$;
revoke all on function public.approval_decide(uuid, text, jsonb) from public, anon;
grant execute on function public.approval_decide(uuid, text, jsonb) to authenticated;

commit;
