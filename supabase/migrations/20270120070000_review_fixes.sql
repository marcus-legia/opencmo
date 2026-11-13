-- Fixes from the whole-branch review of the daily core drafts work (2026-11-12). One block per fix; each says what
-- went wrong. Functions are the latest version with only the named lines changed. Tests: `308_review_fixes`.

-- 1. A core post has one slot per platform. The first slot to post marked the whole post `published`, and the rule
--    for posts posted by hand (`schedule_follow_content`) then cancelled the post's other slots: the post went out on
--    one platform only. The post is now `published` when its last open slot is, so each platform posts at its own
--    time. "I posted it" on the post card still stops everything, as it says.
create or replace function public.post_slots_open(p_deliverable uuid, p_except uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.schedule_slots s
    where s.deliverable_id = p_deliverable and s.id <> p_except
      and (s.status in ('proposed', 'waiting', 'due', 'reminded', 'publishing')
        -- A failed slot whose card still waits (Retry, copy and open) is not over either.
        or (s.status = 'failed' and exists (select 1 from public.approvals a
              where a.ref_kind = 'schedule_slot' and a.ref_id = s.id and a.status = 'waiting'))));
$$;
revoke all on function public.post_slots_open(uuid, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.publish_status(p_slot uuid, p_status text, p_external_id text DEFAULT NULL::text, p_url text DEFAULT NULL::text, p_error jsonb DEFAULT NULL::jsonb, p_zernio_account_id text DEFAULT NULL::text)
 RETURNS schedule_slots
 LANGUAGE plpgsql
 SECURITY DEFINER
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
        update public.content_items set status = 'published', published_at = coalesce(published_at, now()),
          external_url = coalesce(v_url, external_url), updated_at = now()
        where id = v_d.ref_id and status <> 'published' and not public.post_slots_open(v_d.id, v_slot.id);
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

CREATE OR REPLACE FUNCTION public.schedule_mark_posted(p_slot uuid)
 RETURNS approvals
 LANGUAGE plpgsql
 SECURITY DEFINER
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
      update public.content_items set status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
      where id = v_d.ref_id and user_id = v_user and status <> 'published'
        and not public.post_slots_open(v_d.id, v_slot.id);
    end if;
  end if;
  select * into v_row from public.approvals
  where ref_kind = 'schedule_slot' and ref_id = v_slot.id order by created_at desc limit 1;
  return v_row;
end;
$$;

-- The founder cancels the platforms still waiting after one already posted: nothing is left to go out, so the post is
-- published. (A missed or failed slot is asked again, so only a cancellation settles it.)
create or replace function public.schedule_slots_settle_post() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and exists (select 1 from public.schedule_slots s where s.deliverable_id = new.deliverable_id and s.status = 'published')
     and not public.post_slots_open(new.deliverable_id, new.id) then
    update public.content_items c set status = 'published', published_at = coalesce(c.published_at, now()), updated_at = now()
    from public.deliverables d
    where d.id = new.deliverable_id and d.ref_kind = 'content_item' and c.id = d.ref_id and c.status = 'approved';
  end if;
  return new;
end;
$$;
revoke all on function public.schedule_slots_settle_post() from public, anon, authenticated;
drop trigger if exists schedule_slots_settle_post on public.schedule_slots;
create trigger schedule_slots_settle_post after update of status on public.schedule_slots
  for each row execute function public.schedule_slots_settle_post();

-- 2. The photo post migration rebuilt the list of buckets a deletion may name without `captures`, which the purge of
--    unpaid accounts still queues (the purge would fail on its first page capture); and the purge never queued `photos`.
alter table public.storage_deletions drop constraint if exists storage_deletions_bucket_check;
alter table public.storage_deletions add constraint storage_deletions_bucket_check
  check (bucket in ('clips', 'sources', 'renders', 'media', 'exports', 'brand', 'captures', 'photos'));

CREATE OR REPLACE FUNCTION public.purge_unpaid_accounts(p_limit integer DEFAULT 50)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_user uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'p_limit must be between 1 and 500.';
  end if;

  for v_user in
    select p.id
    from public.profiles p
    where p.retention_from + interval '30 days' < now()
      and not public.account_is_paid(p.id)
      -- Work still running (the worker holds a lease): leave it to the next cron run.
      and not exists (
        select 1 from public.tasks t
        where t.user_id = p.id and t.status in ('queued', 'running')
      )
    order by p.retention_from
    limit p_limit
    for update of p skip locked
  loop
    insert into public.storage_deletions (bucket, path, user_id)
    select o.bucket_id, o.name, v_user
    from storage.objects o
    where o.bucket_id in ('clips', 'sources', 'renders', 'media', 'exports', 'brand', 'captures', 'photos')
      and o.name like v_user::text || '/%'
      and not exists (
        select 1 from public.storage_deletions d where d.bucket = o.bucket_id and d.path = o.name
      );
    return next v_user;
  end loop;
end;
$$;

-- 3. A core post is written to 3,000 characters, but approving it checked the limit of its first platform: with
--    Threads first, no core post over 500 characters could be approved, by hand or by autopilot.
CREATE OR REPLACE FUNCTION public.cmo_decide_post(p_id uuid, p_action text, p_text text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS content_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_user uuid := public.require_user();
  v_row public.content_items;
  v_text text;
  v_versions text[];
  v_best real;
  v_best_index smallint;
  v_sim real;
  v_profile text;
  v_label text;
  v_limit integer;
  v_core boolean := false;
  v_outcome uuid;
  v_note uuid;
begin
  if p_action is null or p_action not in ('approve', 'skip') then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':cmo_post', 1713));
  select * into v_row from public.content_items
  where id = p_id and user_id = v_user and department = 'post'
  for update;
  if not found then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'in_review' then
    raise exception 'This post was already decided.' using errcode = 'P0001';
  end if;
  -- A post on a platform without a post profile was planned for X (every post before P3).
  v_profile := public.platform_profile_id(v_row.platform);
  if v_profile is null or public.platform_profile(v_profile)->>'kind' <> 'post' then
    v_profile := 'x';
  end if;
  v_label := public.platform_profile(v_profile)->>'label';
  v_limit := (public.platform_profile(v_profile)->>'limit')::integer;
  -- A core post is written once for every platform it goes to, to the core profile's limit: its first target's own
  -- limit does not apply (Threads cuts a long one into a chain when it posts).
  v_core := cardinality(public.post_targets(v_row.id)) > 1;
  if v_core then
    v_limit := (public.platform_profile('core')->>'limit')::integer;
  end if;

  if p_action = 'skip' then
    update public.content_items set status = 'skipped', decided_at = now(), updated_at = now()
    where id = p_id returning * into v_row;
    insert into public.cmo_draft_outcomes (user_id, item_id, department, action, model, prompt_version, platform)
    values (v_user, p_id, 'post', 'skip', left(coalesce(v_row.body->'gen'->>'model', ''), 100),
            left(coalesce(v_row.body->'gen'->>'prompt_version', ''), 40), v_profile)
    on conflict (department, item_id) do nothing
    returning id into v_outcome;
    -- The reason is remembered once: as the decision's voice note, or, when no note is written (no outcome, a
    -- failure), as feedback, so Writer never reads the same skip twice.
    if p_reason is not null and char_length(trim(p_reason)) > 0 then
      v_note := null;
      if v_outcome is not null then
        begin
          v_note := (public.voice_note_write(v_outcome, left(trim(p_reason), 400))).id;
        exception when others then
          raise warning 'voice note for decision % failed: %', v_outcome, sqlerrm;
        end;
      end if;
      if v_note is null then
        insert into public.cmo_memories (user_id, type, topic, body)
        values (v_user, 'feedback', 'post', left('Skipped the ' || v_label || ' post "' || left(v_row.idea, 120) || '": ' || trim(p_reason), 600));
      end if;
    end if;
    return v_row;
  end if;

  v_text := coalesce(nullif(trim(p_text), ''), v_row.body->>'text');
  if v_text is null or char_length(v_text) = 0 then
    raise exception 'This post is empty.' using errcode = '22023';
  end if;
  if char_length(v_text) > v_limit then
    if v_core then
      raise exception 'A post that goes to several platforms can be at most % characters.', to_char(v_limit, 'FM999,999')
        using errcode = '22023';
    end if;
    raise exception 'Posts on % can be at most % characters.', v_label, to_char(v_limit, 'FM999,999') using errcode = '22023';
  end if;
  if (select count(*) from public.operation_log
      where user_id = v_user and platform = v_profile and action = 'approve' and at > now() - interval '1 day') >= 5 then
    raise exception 'You can approve 5 posts for % a day. Try again tomorrow.', v_label using errcode = 'P0001';
  end if;
  insert into public.operation_log (user_id, platform, action, target) values (v_user, v_profile, 'approve', p_id::text);
  update public.content_items set status = 'approved', final_text = v_text, decided_at = now(), updated_at = now()
  where id = p_id returning * into v_row;

  -- Version 0 is `text`, 1–2 the alternates, in the order the card shows them.
  v_versions := array[v_row.body->>'text'] || coalesce(array(
    select jsonb_array_elements_text(v_row.body->'alternates')
    where jsonb_typeof(v_row.body->'alternates') = 'array'), '{}');
  for i in 1 .. least(coalesce(array_length(v_versions, 1), 0), 3) loop
    continue when v_versions[i] is null;
    v_sim := case when v_versions[i] = v_text then 1 else extensions.similarity(v_versions[i], v_text) end;
    if v_best is null or v_sim > v_best then
      v_best := v_sim;
      v_best_index := i - 1;
    end if;
  end loop;
  -- A post approved as written is labelled at once; its voice note comes from the outcome's own trigger.
  insert into public.cmo_draft_outcomes (
    user_id, item_id, department, action, chosen_version, similarity, edit_mode, classified_at, model, prompt_version, platform
  ) values (
    v_user, p_id, 'post', 'approve', v_best_index, v_best,
    case when v_best >= public.cmo_as_written() then 'NO_MEANINGFUL_EDIT' end,
    case when v_best >= public.cmo_as_written() then now() end,
    left(coalesce(v_row.body->'gen'->>'model', ''), 100), left(coalesce(v_row.body->'gen'->>'prompt_version', ''), 40),
    v_profile
  )
  on conflict (department, item_id) do nothing;
  return v_row;
end;
$$;

-- 4. Every "New photo post" made a new draft and nothing could remove one, so the sixth click failed for good. A
--    founder has one open draft: starting again empties it and hands it back.
create or replace function public.photo_post_create() returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':photo_post', 1719));
  select id into v_id from public.photo_posts where user_id = v_user and status = 'draft' order by created_at desc limit 1;
  if v_id is not null then
    update public.photo_posts set photos = '{}', caption = '', platforms = '{}', updated_at = now() where id = v_id;
    -- Drafts left over from before this rule are closed, so they stop counting.
    update public.photo_posts set status = 'cancelled', updated_at = now()
    where user_id = v_user and status = 'draft' and id <> v_id;
    return v_id;
  end if;
  insert into public.photo_posts (user_id) values (v_user) returning id into v_id;
  return v_id;
end;
$$;

-- 5. A script's caption (up to 2,200 characters) is copied onto its order, whose brief was capped at 4,096 bytes: a
--    long script with a caption broke the cap, the rule swallowed the error, and no script card was raised for a
--    script the founder paid for. The brief now holds 8,192 bytes.
alter table public.work_orders drop constraint if exists work_orders_brief_check;
alter table public.work_orders add constraint work_orders_brief_check
  check (jsonb_typeof(brief) = 'object' and octet_length(brief::text) <= 8192);

CREATE OR REPLACE FUNCTION public.cmo_script_edit_beat(p_order uuid, p_beat integer, p_say text, p_show text, p_version timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_user uuid := public.require_user();
  v_order public.work_orders;
  v_beats integer;
  v_say text := nullif(trim(coalesce(p_say, '')), '');
  v_show text := nullif(trim(coalesce(p_show, '')), '');
  v_beat jsonb;
begin
  select * into v_order from public.work_orders
  where id = p_order and user_id = v_user and kind = 'write_video_brief' for update;
  if not found or jsonb_typeof(v_order.brief->'storyboard') is distinct from 'array' then
    raise exception 'Script not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.approvals where user_id = v_user and ref_kind = 'work_order' and ref_id = v_order.id
                 and kind = 'script' and status in ('approved', 'edited')) then
    raise exception 'Approve the script first.' using errcode = 'P0001';
  end if;
  if p_version is distinct from v_order.updated_at then
    raise exception 'This script changed. Look at it again before editing.' using errcode = 'P0001';
  end if;
  v_beats := jsonb_array_length(v_order.brief->'storyboard');
  if p_beat is null or p_beat < 1 or p_beat > v_beats then
    raise exception 'That beat is not in this script.' using errcode = '22023';
  end if;
  if v_say is null and v_show is null then
    raise exception 'Write what to say or what to show.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_say, '')) > 300 or char_length(coalesce(v_show, '')) > 300 then
    raise exception 'Keep each line of a beat under 300 characters.' using errcode = '22023';
  end if;
  v_beat := (v_order.brief->'storyboard'->(p_beat - 1))
    || case when v_say is not null then jsonb_build_object('say', v_say) else '{}'::jsonb end
    || case when v_show is not null then jsonb_build_object('show', v_show) else '{}'::jsonb end;
  -- The order's brief is capped at 8192 bytes (`work_orders_brief_check`): say so in words before the constraint does.
  if octet_length(jsonb_set(v_order.brief, array['storyboard', (p_beat - 1)::text], v_beat)::text) > 8192 then
    raise exception 'This script is too long to save. Shorten this beat or another one.' using errcode = '22023';
  end if;
  update public.work_orders set brief = jsonb_set(brief, array['storyboard', (p_beat - 1)::text], v_beat), updated_at = clock_timestamp()
  where id = v_order.id
  returning * into v_order;
  insert into public.work_order_events (user_id, order_id, department, kind, text)
  values (v_user, v_order.id, 'writer', 'note', left('You edited beat ' || p_beat || ' of “' || coalesce(v_order.title, 'the script') || '”', 200));
  return jsonb_build_object('version', v_order.updated_at, 'beat', p_beat, 'say', v_beat->>'say', 'show', v_beat->>'show');
end;
$$;

-- 6. The planner takes up to 7 video scripts a week on each of three platforms, all ordered when the week is planned,
--    but only 5 scripts a day could be queued: the rest failed silently and their items stayed planned. 25 covers a
--    full week's plan and a few asked in the chat.
create or replace function public.cmo_job_daily_limit(p_kind text) returns integer
language sql immutable as $$
  select case p_kind when 'plan_week' then 5 when 'post_draft' then 10 when 'sales_scan' then 3
    when 'competitor_research' then 2 when 'pull_metrics' then 2 when 'summarize_memory' then 1 when 'review_week' then 1
    when 'write_caption' then 20 when 'write_video_brief' then 25 when 'write_slides' then 10 when 'publish_post' then 100 when 'niche_video_research' then 2
    -- cmo-review-3 2.2: one rating round a day (`cmo_rate_drafts`), with room for a retry.
    when 'distill_ratings' then 2
    when 'repurpose_post' then 20
    when 'photo_caption' then 20
    else 0 end
$$;

-- 7. "Post as a thread" is a setting of the failed slot. Pressed after the slot's window, the slot was missed and a
--    new one proposed with empty settings: the card showed one long post again and X refused it again. A new slot now
--    keeps the thread setting of the slot it replaces.
CREATE OR REPLACE FUNCTION public.schedule_propose(p_deliverable uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
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
    -- Every platform of the post's slot (Writer's old items: the one platform of their label).
    select array(select t from unnest(public.post_targets(c.id)) with ordinality as u(t, o)
                 where t in ('x', 'threads', 'linkedin', 'facebook') order by o)
      into v_platforms
    from public.content_items c where c.id = v_d.ref_id and c.status = 'approved';
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

-- 8. A photo post to Threads took a caption of 2,200 characters, but only a text post is cut into a chain: the
--    carousel would go out with a caption Threads refuses. It is refused here, in words, before it is scheduled.
CREATE OR REPLACE FUNCTION public.photo_post_schedule(p_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_user uuid := public.require_user();
  v_row public.photo_posts;
  v_platform text;
  v_d uuid;
begin
  select * into v_row from public.photo_posts where id = p_id and user_id = v_user for update;
  if not found then
    raise exception 'Photo post not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'This photo post is already scheduled.' using errcode = 'P0001';
  end if;
  if cardinality(v_row.photos) = 0 then
    raise exception 'Add at least one photo.' using errcode = '22023';
  end if;
  if cardinality(v_row.platforms) = 0 then
    raise exception 'Pick at least one platform.' using errcode = '22023';
  end if;
  perform public.photo_post_check(cardinality(v_row.photos), v_row.platforms);
  -- The caption rules of a video caption: 1 to 2,200 characters, five hashtags at most, no link.
  perform public.caption_check('instagram_caption', v_row.caption, null);
  -- Threads takes 500 characters a post, and a post with photos is never cut into a chain.
  if 'threads' = any (v_row.platforms) and char_length(btrim(v_row.caption)) > 500 then
    raise exception 'Threads takes up to 500 characters with photos. Shorten the caption, or leave Threads out.'
      using errcode = '22023';
  end if;
  foreach v_platform in array v_row.platforms loop
    if not exists (select 1 from public.social_accounts where user_id = v_user and platform = v_platform and status = 'connected') then
      raise exception 'Connect your % account first: photos go out only from a connected account.',
        public.schedule_platform_label(v_platform) using errcode = 'P0001';
    end if;
  end loop;
  update public.photo_posts set status = 'scheduled', updated_at = now() where id = p_id;
  insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
  values (v_user, (public.work_order_week_root(v_user)).id, 'photo_post', 'photo_post', p_id, 'decided')
  returning id into v_d;
  return public.schedule_propose(v_d);
end;
$$;

-- 9. X was given 25,000 characters and Facebook 5,000, but an approved post is kept in 4,000 (`final_text`), a draft's
--    three versions share 16 KB, and a schedule card carries 5,000: a longer post failed on Approve with a raw
--    constraint error, or its schedule card vanished. Both platforms take 4,000 here, which every step carries; that
--    is still a long post on X (a free account takes 280).
CREATE OR REPLACE FUNCTION public.platform_profile(p_id text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $$
  select case p_id
    when 'x' then '{"kind": "post", "limit": 4000, "title": null, "hashtags": 0, "label": "X"}'::jsonb
    when 'threads' then '{"kind": "post", "limit": 500, "title": null, "hashtags": 0, "label": "Threads"}'::jsonb
    when 'linkedin' then '{"kind": "post", "limit": 3000, "title": null, "hashtags": 0, "label": "LinkedIn"}'::jsonb
    when 'facebook' then '{"kind": "post", "limit": 4000, "title": null, "hashtags": 0, "label": "Facebook"}'::jsonb
    when 'core' then '{"kind": "core", "limit": 3000, "title": null, "hashtags": 0, "label": "Post"}'::jsonb
    when 'instagram_caption' then '{"kind": "caption", "limit": 2200, "title": null, "hashtags": 5, "label": "Instagram caption"}'::jsonb
    when 'tiktok_caption' then '{"kind": "caption", "limit": 2200, "title": null, "hashtags": 5, "label": "TikTok caption"}'::jsonb
    when 'youtube' then '{"kind": "youtube", "limit": 5000, "title": 100, "hashtags": 3, "label": "YouTube title and description"}'::jsonb
  end
$$;
