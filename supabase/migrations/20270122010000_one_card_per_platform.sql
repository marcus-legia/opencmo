-- One card per platform for the founder's own video (owner, 2026-11-13). A finished video no longer gets a card of its
-- own: its captions are written at once, and each platform's schedule card shows the video, its caption (editable)
-- and its time. Approving that card approves the caption and the time; skipping it skips the caption. The founder
-- approves once per platform, as a post card approves its words and its time (cmo-review-3 1.2).
--
-- A platform with no connected account takes a video too: the card gives the video to download and the caption to
-- copy (`schedule_ready_check` no longer refuses it).

begin;

-- What the founder decided on a video's schedule card, carried to its platform's caption.
create or replace function public.schedule_caption_decided(p_slot public.schedule_slots, p_status text) returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  update public.content_items c
  set status = p_status, decided_at = coalesce(c.decided_at, now()), updated_at = now()
  from public.deliverables d
  where d.id = p_slot.deliverable_id and d.ref_kind = 'clip' and d.kind = 'video'
    and c.clip_id = d.ref_id and c.user_id = p_slot.user_id and c.department = 'video'
    and c.platform = public.platform_profile_id(p_slot.platform) and c.status = 'in_review';
end;
$$;
revoke all on function public.schedule_caption_decided(public.schedule_slots, text) from public, anon, authenticated;

-- The founder's finished video, rendered (and looked at): Writer writes its captions, the video becomes the order's
-- deliverable, and each caption that lands proposes its platform's time on a card (`caption_cards_refresh`).
create or replace function public.post_video_ready(p_order public.work_orders, p_clip uuid) returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_hash text := p_order.brief->>'finished_hash';
  v_root public.work_orders;
  v_caption public.work_orders;
  v_free integer;
  v_profiles text[];
  v_deliverable uuid;
  v_again boolean;
begin
  if p_order.kind <> 'post_video' or p_order.status not in ('running', 'waiting_founder') then
    return;
  end if;
  if not public.cmo_paused(p_order.user_id) and not exists (select 1 from public.work_orders
      where user_id = p_order.user_id and kind = 'write_caption' and brief->>'ref_id' = p_clip::text
        and brief->>'document_hash' is not distinct from v_hash and status not in ('failed', 'cancelled')) then
    begin
      v_profiles := public.caption_targets(p_order.user_id);
      v_root := public.work_order_week_root(p_order.user_id);
      v_free := v_root.budget_credits - v_root.spent_credits - coalesce((
        select sum(budget_credits - spent_credits) from public.work_orders
        where parent_id = v_root.id and status not in ('done', 'failed', 'cancelled')), 0);
      v_caption := public.work_order_create(p_order.user_id, v_root.week, v_root.id, 'write_caption',
        left('Captions for “' || coalesce(nullif((select hook from public.clips where id = p_clip), ''), 'your video') || '”', 200),
        jsonb_build_object('objective', 'Write the captions for each platform.', 'ref_kind', 'editor_project', 'ref_id', p_clip,
          'clip_ids', jsonb_build_array(p_clip), 'profiles', to_jsonb(v_profiles), 'document_hash', v_hash,
          'done_when', 'Each platform has its caption on its schedule card.'),
        least(public.cmo_job_price('write_caption'), greatest(v_free, 0)), null, '{}', 'event');
      perform public.writer_order_start(v_caption, jsonb_build_object('clip_ids', jsonb_build_array(p_clip),
        'profiles', to_jsonb(v_profiles), 'ref_kind', 'editor_project', 'ref_id', p_clip));
    exception when others then
      raise warning 'captions for video % failed: %', p_clip, sqlerrm;
    end;
  end if;
  -- A video posted before and edited since has its deliverable already: it now belongs to this order.
  insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
  values (p_order.user_id, p_order.id, 'video', 'clip', p_clip, 'decided')
  on conflict (ref_kind, ref_id) do update set order_id = excluded.order_id, status = 'decided'
  returning id, (xmax <> 0) into v_deliverable, v_again;
  if v_again then
    perform public.schedule_propose(v_deliverable);
  end if;
  perform public.work_order_move(p_order.id, 'done', 'Ready: approve it on each platform''s card', null,
    'The video is ready to post; each platform asks on its own card.');
end;
$$;
revoke all on function public.post_video_ready(public.work_orders, uuid) from public, anon, authenticated;

create or replace function public.post_video_render_settled(p_order public.work_orders, p_task public.tasks) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- Only the render of the edit as it is still finished: one changed since is not what the founder marked.
  if p_order.status <> 'running' or p_task.settings_hash is distinct from p_order.brief->>'finished_hash'
     or not exists (select 1 from public.editor_projects p where p.clip_id = p_task.clip_id
                    and p.finished_hash = p_task.settings_hash and p.finished_hash = public.editor_document_hash(p.document)) then
    return;
  end if;
  if p_task.status = 'done' then
    if not public.look_check_begin(p_order.user_id, 'editor_project', p_task.clip_id, p_order.id, p_task.settings_hash,
        jsonb_build_array(jsonb_build_object('path', p_task.output_path, 'clip_id', p_task.clip_id))) then
      perform public.post_video_ready(p_order, p_task.clip_id);
    end if;
  elsif p_task.status = 'failed' then
    perform public.work_order_move(p_order.id, 'failed', null, jsonb_build_object('code', 'render_failed',
      'message', left(coalesce(nullif(p_task.error, ''), 'The render failed.'), 200), 'retryable', true,
      'repair_hint', 'Mark the edit finished again to render it again.'));
  end if;
end;
$$;


create or replace function public.look_check_raise(p_check public.look_checks) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order public.work_orders;
begin
  case p_check.ref_kind
    when 'editor_project' then
      -- Only for the edit that was rendered: an edit made during the check gets its own render and card.
      if p_check.doc_key = (select public.editor_document_hash(document) from public.editor_projects where clip_id = p_check.ref_id) then
        select * into v_order from public.work_orders where id = p_check.order_id and kind = 'post_video';
        if found then
          -- The founder's own finished video: no card of its own, each platform asks on its schedule card.
          perform public.post_video_ready(v_order, p_check.ref_id);
        else
          perform public.approval_raise(p_check.user_id, 'editor_project', p_check.ref_id);
          if p_check.order_id is not null then
            perform public.work_order_wait_founder(p_check.order_id, 'Your video is rendered');
          end if;
        end if;
      end if;
    when 'short_batch' then
      update public.short_batches set status = 'waiting_founder' where id = p_check.ref_id and status = 'rendering';
      if found then
        perform public.approval_raise(p_check.user_id, 'short_batch', p_check.ref_id);
        if p_check.order_id is not null then
          perform public.work_order_wait_founder(p_check.order_id, 'Shorts are ready for you');
        end if;
      end if;
    when 'studio_step' then
      -- `studio_steps_sync` raises the card when the step turns `waiting`.
      update public.studio_steps set status = 'waiting' where id = p_check.ref_id and status = 'running';
      if found and p_check.order_id is not null then
        perform public.work_order_wait_founder(p_check.order_id, 'Your slideshow is rendered');
      end if;
  end case;
  update public.look_checks set raised_at = now() where id = p_check.id;
end;
$$;


create or replace function public.caption_cards_refresh(p_clip uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_batch uuid;
  v_d uuid;
  v_slot uuid;
begin
  perform public.approval_refresh('editor_project', p_clip);
  for v_batch in select distinct s.batch_id from public.shorts s where s.short_clip_id = p_clip loop
    perform public.approval_refresh('short_batch', v_batch);
  end loop;
  for v_batch in select st.id from public.studio_steps st where st.clip_id = p_clip and st.kind = 'slideshow' and st.status = 'waiting' loop
    perform public.approval_refresh('studio_step', v_batch);
  end loop;
  -- The founder's own video goes out one card per platform (owner, 2026-11-13): a caption written proposes its
  -- platform's time, and a card already asking shows the new words. Scheduling never fails the caption's save.
  begin
    for v_d in select d.id from public.deliverables d join public.work_orders o on o.id = d.order_id
      where d.ref_kind = 'clip' and d.ref_id = p_clip and d.kind = 'video' and o.kind = 'post_video'
    loop
      perform public.schedule_propose(v_d);
      for v_slot in select id from public.schedule_slots where deliverable_id = v_d and status = 'proposed' loop
        perform public.approval_refresh('schedule_slot', v_slot);
      end loop;
    end loop;
  exception when others then
    raise warning 'schedule rule for the captions of % failed: %', p_clip, sqlerrm;
  end;
end;
$$;


create or replace function public.deliverables_caption_rules() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_caption public.content_items;
begin
  if new.ref_kind <> 'clip' or new.kind not in ('video', 'short') then
    return new;
  end if;
  -- The founder's own video: each caption is approved on its platform's schedule card, not with the video.
  if exists (select 1 from public.work_orders where id = new.order_id and kind = 'post_video') then
    return new;
  end if;
  for v_caption in select * from public.content_items where clip_id = new.ref_id and department = 'video' and user_id = new.user_id loop
    perform public.caption_deliver(v_caption);
  end loop;
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
      and public.post_schedules(c.status, v_d.id);
  elsif v_d.kind = 'photo_post' and v_d.ref_kind = 'photo_post' then
    -- The founder's own photos (D7): every platform they picked, each from its connected account.
    select array(select p from unnest(platforms) p where p in ('tiktok', 'instagram', 'threads') order by p) into v_platforms
    from public.photo_posts where id = v_d.ref_id and user_id = v_d.user_id and status = 'scheduled';
  elsif v_d.kind in ('short', 'slideshow', 'video') and v_d.ref_kind = 'clip' then
    select array_agg(p) into v_platforms from unnest(array['tiktok', 'instagram', 'youtube']) p
    where exists (select 1 from public.content_items c
      where c.clip_id = v_d.ref_id and c.department = 'video' and c.status in ('in_review', 'approved')
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


create or replace function public.schedule_content(p_deliverable uuid, p_platform text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_d public.deliverables;
  v_text text;
  v_title text;
  v_doc text;
  v_image_clip uuid;
  v_image jsonb;
  v_thread jsonb;
  v_variant text;
  v_photos text[];
begin
  select * into v_d from public.deliverables where id = p_deliverable;
  if not found then
    return null;
  end if;
  if v_d.ref_kind = 'content_item' then
    select coalesce(body->>'text', ''), case when public.thread_valid(body) then body->'thread' end, photos
    into v_text, v_thread, v_photos from public.content_items where id = v_d.ref_id;
    -- The founder had the post rewritten for this platform: its slot there carries the rewrite, the others the core.
    v_variant := public.post_variant_text(v_d.ref_id, p_platform);
    if v_variant is not null then
      v_text := v_variant;
      v_thread := null;
    end if;
    -- The post's newest image (P5 B4), as its cover still of the image's document as it is now. Only a post with an
    -- image carries the key, so the hash of a post without one is what it was before P5.
    select i.ref_id into v_image_clip from public.deliverables i
    where i.post_id = v_d.ref_id and i.kind = 'image' order by i.created_at desc limit 1;
    if v_image_clip is not null then
      select jsonb_build_object('clip_id', v_image_clip,
          'object', t.output->'stills'->coalesce((t.output->>'cover_index')::integer, 0)->>'object',
          'bytes', t.output->'stills'->coalesce((t.output->>'cover_index')::integer, 0)->'bytes')
        into v_image
      from public.tasks t join public.editor_projects p on p.clip_id = t.clip_id
      where t.clip_id = v_image_clip and t.kind = 'render_stills' and t.status = 'done'
        and t.settings_hash = public.editor_document_hash(p.document)
      order by t.finished_at desc nulls last limit 1;
      if v_image->>'object' is null then
        v_image := null;
      end if;
    end if;
    -- The founder's own photos (owner, 2026-11-13) go out with the post on every platform of its slot, in their order,
    -- in place of a generated image. The publish job posts `photos` as it does a photo post's.
    if cardinality(v_photos) > 0 then
      v_image := null;
    end if;
    return jsonb_build_object('clip_id', null, 'text', v_text, 'title', null,
      'content_hash', public.approval_hash(jsonb_build_object('text', v_text)
        || case when v_image is not null then jsonb_build_object('image', v_image->>'object') else '{}'::jsonb end
        || case when cardinality(v_photos) > 0 then jsonb_build_object('photos', to_jsonb(v_photos)) else '{}'::jsonb end
        || case when v_thread is not null then jsonb_build_object('thread', v_thread) else '{}'::jsonb end))
      || case when v_image is not null then jsonb_build_object('image', v_image) else '{}'::jsonb end
      || case when cardinality(v_photos) > 0 then jsonb_build_object('photos', to_jsonb(v_photos)) else '{}'::jsonb end
      || case when v_thread is not null then jsonb_build_object('thread', v_thread) else '{}'::jsonb end;
  elsif v_d.ref_kind = 'photo_post' then
    -- The caption and the photos in the founder's order; both are in the hash, so a change after approval refuses it.
    return (select jsonb_build_object('clip_id', null, 'text', p.caption, 'title', null, 'photos', to_jsonb(p.photos),
        'content_hash', public.approval_hash(jsonb_build_object('text', p.caption, 'photos', to_jsonb(p.photos))))
      from public.photo_posts p where p.id = v_d.ref_id);
  elsif v_d.ref_kind = 'clip' then
    select public.editor_document_hash(document) into v_doc from public.editor_projects where clip_id = v_d.ref_id;
    select body->>'text', body->>'title' into v_text, v_title
    from public.content_items
    where clip_id = v_d.ref_id and department = 'video' and platform = public.platform_profile_id(p_platform)
      and status in ('in_review', 'approved', 'published');
    return jsonb_build_object('clip_id', v_d.ref_id, 'text', v_text, 'title', v_title,
      'content_hash', public.approval_hash(jsonb_strip_nulls(jsonb_build_object('document_hash', v_doc, 'text', v_text,
        'title', v_title))));
  end if;
  return null;
end;
$$;


create or replace function public.schedule_ready_check(p_slot public.schedule_slots) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- No connected account: the founder downloads the video (or copies the post) and posts it, a video too
  -- (owner, 2026-11-13).
  if p_slot.mode = 'intent' then
    return;
  end if;
  if not exists (select 1 from public.social_accounts where id = p_slot.account_id and status = 'connected') then
    raise exception 'Reconnect your % account first.', public.schedule_platform_label(p_slot.platform) using errcode = 'P0001';
  end if;
  if p_slot.platform = 'tiktok' and jsonb_typeof(p_slot.options->'privacy') is distinct from 'string' then
    raise exception 'Choose who can see it on TikTok.' using errcode = 'P0001';
  end if;
end;
$$;


create or replace function public.approval_decide(p_id uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS public.approvals
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
  v_code text := nullif(v_payload->>'reason_code', '');
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
    if v_row.kind = 'schedule' then
      -- A video goes out one card per platform (owner, 2026-11-13): the card's caption is its platform's, changed
      -- while the card still asks.
      select c.* into v_caption from public.schedule_slots s
      join public.deliverables d on d.id = s.deliverable_id and d.ref_kind = 'clip'
      join public.content_items c on c.clip_id = d.ref_id and c.department = 'video' and c.user_id = v_user
        and c.platform = public.platform_profile_id(s.platform) and c.status in ('in_review', 'approved')
      where s.id = v_row.ref_id and s.user_id = v_user and s.status = 'proposed'
      for update of c;
      if not found then
        raise exception 'This card has no caption to change.' using errcode = '22023';
      end if;
    else
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
      -- The founder's chip (cmo-review-3 2.1): checked here, kept on the decision's outcome. Without words of their
      -- own, the chip's name is the skip reason the planner and the voice note read.
      if v_code is not null and public.cmo_reason_label(v_code) is null then
        raise exception 'Pick one of the reasons on the card.' using errcode = '22023';
      end if;
      if p_action = 'skip' and v_reason is null and v_code is not null and v_code <> 'OTHER' then
        v_reason := public.cmo_reason_label(v_code);
      end if;
      perform public.cmo_decide_post(v_row.ref_id, p_action, v_payload->>'text', v_reason);
      perform public.cmo_label_outcome(v_user, v_row.ref_id, v_code);
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
        -- Skipped on this platform: its caption is skipped too, so no new time is asked for it.
        perform public.schedule_caption_decided(v_slot, 'skipped');
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
        -- The card showed the caption with the time: approving one approved the other.
        perform public.schedule_caption_decided(v_slot, 'approved');
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

commit;
