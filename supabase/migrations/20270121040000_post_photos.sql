-- Photos on a text post (owner, 2026-11-13; docs/plans/cmo/2026-11-13-post-photos-plan.md). The founder adds up to
-- four of their own photos on the post's card; they are part of what the founder approves (the post card's snapshot,
-- each schedule card's hash) and go out with the post on every platform of its slot, in place of a generated image.
-- Photos live in the `photos` bucket under `<user>/<post>/` for now; uploads move to DigitalOcean storage later this
-- week.

alter table public.content_items add column if not exists photos text[] not null default '{}';
alter table public.content_items drop constraint if exists content_items_photos_check;
alter table public.content_items add constraint content_items_photos_check check (cardinality(photos) <= 4);

create or replace function public.reserve_upload(p_bucket text, p_object_name text, p_size bigint, p_content_type text, p_project_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'storage'
    AS $$
declare
  v_user uuid := public.require_user();
  v_plan text;
  v_limits record;
  v_bytes bigint;
  v_objects bigint;
  v_existing public.upload_reservations;
  v_row public.upload_reservations;
  v_parts text[] := string_to_array(coalesce(p_object_name, ''), '/');
begin
  -- A photo of a photo post (20270120060000) or of a text post (20270121040000): a JPEG, PNG or WebP of 10 MB at most,
  -- under the founder's draft, or under a post of theirs that is in review or approved.
  if p_bucket = 'photos' then
    if p_size is null or p_size <= 0 or p_size > 10485760
       or coalesce(p_content_type, '') not in ('image/jpeg', 'image/png', 'image/webp') then
      raise exception 'Use a JPEG, PNG or WebP photo of 10 MB at most.' using errcode = '22023';
    end if;
    if p_project_id is null or array_length(v_parts, 1) <> 3 or v_parts[1] is distinct from v_user::text
       or v_parts[2] is distinct from p_project_id::text
       or not (exists (select 1 from public.photo_posts where id = p_project_id and user_id = v_user and status = 'draft')
               or exists (select 1 from public.content_items where id = p_project_id and user_id = v_user
                            and department = 'post' and status in ('in_review', 'approved'))) then
      raise exception 'Photo post not found.' using errcode = 'P0002';
    end if;
    -- A text post's photos go to every platform of its slot, and Threads and LinkedIn do not take WebP.
    if p_content_type = 'image/webp'
       and not exists (select 1 from public.photo_posts where id = p_project_id and user_id = v_user and status = 'draft') then
      raise exception 'Use a JPEG or PNG photo: Threads and LinkedIn do not take WebP.' using errcode = '22023';
    end if;
    -- The post is in the path; `upload_reservations.project_id` points at jobs, so the reservation names none.
    p_project_id := null;
  elsif p_bucket not in ('sources', 'media', 'exports') or p_size is null or p_size <= 0
     or p_size > 2147483648 or coalesce(p_content_type, '') not like 'video/%' then
    raise exception 'That video cannot be uploaded.' using errcode = '22023';
  end if;
  if v_parts[1] is distinct from v_user::text
     or (p_bucket = 'sources' and array_length(v_parts, 1) <> 2)
     or (p_bucket in ('media', 'exports') and array_length(v_parts, 1) <> 3) then
    raise exception 'Invalid upload path.' using errcode = '22023';
  end if;
  if p_bucket = 'sources' and p_project_id is not null then
    raise exception 'A source upload cannot belong to an existing project.' using errcode = '22023';
  end if;
  if p_bucket = 'media' and (
    p_project_id is null or v_parts[2] is distinct from p_project_id::text or
    not exists(select 1 from public.jobs where id = p_project_id and user_id = v_user)
  ) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if p_bucket = 'exports' and (
    p_project_id is null or not exists(
      select 1 from public.clips c
      join public.jobs j on j.id = c.job_id
      where c.id::text = v_parts[2]
        and c.job_id = p_project_id
        and j.user_id = v_user
        and j.purging_at is null
    )
  ) then
    raise exception 'Clip not found.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':upload', 1703));
  delete from public.upload_reservations
    where user_id = v_user and status = 'reserved' and expires_at <= now();

  select * into v_existing from public.upload_reservations
    where bucket = p_bucket and object_name = p_object_name;
  if found then
    if v_existing.user_id = v_user and v_existing.declared_size = p_size
       and v_existing.content_type = p_content_type
       and v_existing.project_id is not distinct from p_project_id
       and v_existing.status = 'reserved' and v_existing.expires_at > now() then
      return jsonb_build_object('bucket', v_existing.bucket, 'object_name', v_existing.object_name,
        'expires_at', v_existing.expires_at);
    end if;
    raise exception 'That upload path is already in use.' using errcode = '22023';
  end if;

  select coalesce(plan, 'free') into v_plan from public.profiles where id = v_user;
  select * into v_limits from public.plan_usage_limits(v_plan);
  select coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0), count(*)
    into v_bytes, v_objects
    from storage.objects o
    where o.bucket_id in ('sources', 'media', 'exports', 'photos')
      and (storage.foldername(o.name))[1] = v_user::text;
  select v_bytes + coalesce(sum(r.declared_size), 0), v_objects + count(*)
    into v_bytes, v_objects
    from public.upload_reservations r
    where r.user_id = v_user and r.status = 'reserved' and r.expires_at > now()
      and not exists(select 1 from storage.objects o where o.bucket_id = r.bucket and o.name = r.object_name);
  if v_bytes + p_size > v_limits.stored_bytes or v_objects + 1 > v_limits.stored_objects then
    raise exception 'You have reached your storage limit for this plan.' using errcode = 'P0001';
  end if;

  insert into public.upload_reservations(user_id, bucket, object_name, declared_size, content_type, project_id)
    values(v_user, p_bucket, p_object_name, p_size, p_content_type, p_project_id)
    returning * into v_row;
  return jsonb_build_object('bucket', v_row.bucket, 'object_name', v_row.object_name,
    'expires_at', v_row.expires_at);
end;
$$;


create or replace function public.approval_snapshot_base(p_ref_kind text, p_ref_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v jsonb;
  v_captions jsonb;
begin
  case p_ref_kind
    when 'content_item' then
      select jsonb_build_object('kind', 'post', 'platform', platform, 'day', day, 'idea', idea,
        'text', coalesce(body->>'text', ''),
        'alternates', case when jsonb_typeof(body->'alternates') = 'array' then body->'alternates' else '[]'::jsonb end,
        'rationale', coalesce(body->>'rationale', reason))
        -- The founder's own photos are part of what they approve; a post without any keeps its old hash.
        || case when cardinality(photos) > 0 then jsonb_build_object('photos', to_jsonb(photos)) else '{}'::jsonb end
      into v from public.content_items where id = p_ref_id;
    when 'opportunity' then
      select jsonb_build_object('kind', 'reply', 'url', url, 'community', community, 'title', title,
        'reply', reply, 'score', score, 'score_parts', score_parts)
        || case when rule is not null then jsonb_build_object('rule', rule, 'rule_why', coalesce(rule_why, '')) else '{}'::jsonb end
      into v from public.opportunities where id = p_ref_id and (rule is distinct from 'skip');
    when 'goal' then
      select jsonb_build_object('kind', 'goal', 'week', week, 'goal', goal, 'metric', metric, 'target', target)
      into v from public.cmo_goals where id = p_ref_id;
    when 'correction' then
      select jsonb_build_object('kind', 'correction', 'rule', rule, 'source_edits', source_edits)
        || case when edit_mode is not null then jsonb_build_object('edit_mode', edit_mode, 'times', times) else '{}'::jsonb end
      into v from public.cmo_corrections where id = p_ref_id;
    when 'studio_step' then
      select case s.kind
        when 'script' then jsonb_build_object('kind', 'script', 'step_id', s.id, 'clip_id', s.clip_id, 'tool', s.tool,
          'title', coalesce(s.card->>'title', ''), 'seconds', s.card->'seconds', 'aspect', s.card->'aspect',
          'beats', case when jsonb_typeof(s.card->'beats') = 'array' then s.card->'beats' else '[]'::jsonb end,
          'price_credits', s.price_credits)
        -- The slideshow as built (B3): its slides, the MP4 and the PNG set of this exact document. Any edit to the
        -- document changes `document_hash` and supersedes the card.
        when 'slideshow' then jsonb_build_object('kind', 'slideshow', 'step_id', s.id, 'clip_id', s.clip_id,
          'title', coalesce(s.card->>'title', ''), 'aspect', s.card->'aspect',
          'slides', case when jsonb_typeof(s.card->'slides') = 'array' then s.card->'slides' else '[]'::jsonb end,
          'document_hash', (select public.editor_document_hash(p.document) from public.editor_projects p where p.clip_id = s.clip_id),
          'mp4_path', s.card->'mp4_path', 'png_set_path', s.card->'png_set_path')
        else jsonb_build_object('kind', 'price', 'step_id', s.id, 'clip_id', s.clip_id, 'tool', s.tool,
          'title', coalesce(s.card->>'title', ''), 'what', coalesce(s.card->>'what', ''), 'seconds', s.card->'seconds',
          'wait_minutes', s.card->'wait_minutes',
          'keyframes', case when jsonb_typeof(s.card->'keyframes') = 'array' then s.card->'keyframes' else '[]'::jsonb end,
          'shots', coalesce(s.card->'shots', '0'::jsonb), 'price_credits', s.price_credits)
        end
      into v from public.studio_steps s where s.id = p_ref_id;
      if v->>'kind' = 'slideshow' then
        v_captions := public.caption_snapshots(array[(v->>'clip_id')::uuid]);
      end if;
    when 'editor_project' then
      select jsonb_build_object('kind', 'finished_video', 'clip_id', c.id, 'title', coalesce(c.hook, ''),
        'document_hash', public.editor_document_hash(p.document),
        'render_task_id', r.id, 'render_path', r.output_path, 'seconds', r.duration)
      into v
      from public.editor_projects p
      join public.clips c on c.id = p.clip_id
      left join lateral (
        select t.id, t.output_path, t.duration from public.tasks t
        where t.clip_id = p.clip_id and t.kind = 'render_document' and t.status = 'done'
          and t.settings_hash = public.editor_document_hash(p.document)
        order by t.finished_at desc nulls last, t.created_at desc
        limit 1
      ) r on true
      where p.clip_id = p_ref_id;
      v_captions := public.caption_snapshots(array[p_ref_id]);
    when 'short_batch' then
      select jsonb_build_object('kind', 'shorts_batch', 'batch_id', b.id, 'parent_clip_id', b.parent_clip_id,
        'title', coalesce(c.hook, ''), 'parent_hash', b.parent_hash,
        'shorts', coalesce((
          select jsonb_agg(jsonb_build_object('short_id', s.id, 'short_clip_id', s.short_clip_id,
            'start', s.source_start, 'end', s.source_end, 'hook', s.hook, 'reason', s.reason)
            order by s.source_start, s.id)
          from public.shorts s where s.batch_id = b.id and s.status <> 'failed'), '[]'::jsonb))
      into v
      from public.short_batches b
      left join public.clips c on c.id = b.parent_clip_id
      where b.id = p_ref_id;
      v_captions := public.caption_snapshots(array(
        select s.short_clip_id from public.shorts s
        where s.batch_id = p_ref_id and s.status <> 'failed' and s.short_clip_id is not null
        order by s.source_start, s.id));
    when 'schedule_slot' then
      -- Content, time, account and the platform's fields: everything the founder approves before it posts
      -- (approval.md rule 1). `content_hash` covers the words and the edit, so a change to either supersedes it.
      select jsonb_build_object('kind', 'schedule', 'slot_id', s.id, 'deliverable_id', s.deliverable_id,
        'deliverable_kind', d.kind, 'platform', s.platform, 'mode', s.mode, 'account_id', s.account_id,
        'handle', a.handle, 'publish_at', to_char(s.publish_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'options', s.options, 'last_error', s.error->>'message')
        || public.schedule_content(s.deliverable_id, s.platform)
      into v
      from public.schedule_slots s
      join public.deliverables d on d.id = s.deliverable_id
      left join public.social_accounts a on a.id = s.account_id
      where s.id = p_ref_id;
    else
      raise exception 'Unknown card source.' using errcode = '22023';
  end case;
  if v is not null and v_captions is not null then
    v := v || jsonb_build_object('captions', v_captions);
  end if;
  return v;
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
      and status in ('approved', 'published');
    return jsonb_build_object('clip_id', v_d.ref_id, 'text', v_text, 'title', v_title,
      'content_hash', public.approval_hash(jsonb_strip_nulls(jsonb_build_object('document_hash', v_doc, 'text', v_text,
        'title', v_title))));
  end if;
  return null;
end;
$$;


create or replace function public.content_items_post_image() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_root public.work_orders;
  v_profile text;
begin
  if new.department <> 'post' or not new.wants_image or new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;
  begin
    -- The founder added their own photos: no generated image (owner, 2026-11-13).
    if public.cmo_paused(new.user_id) or cardinality(new.photos) > 0
       or exists (select 1 from public.deliverables where post_id = new.id and kind = 'image')
       or exists (select 1 from public.work_orders where user_id = new.user_id and kind = 'build_post_image'
                  and brief->>'postId' = new.id::text and status not in ('failed', 'cancelled')) then
      return new;
    end if;
    v_profile := coalesce(public.platform_profile_id(new.platform), 'x');
    v_root := public.work_order_week_root(new.user_id);
    perform public.work_order_create(new.user_id, v_root.week, v_root.id, 'build_post_image',
      left('Image for “' || new.idea || '”', 200),
      -- The image's title is one slide heading (`SLIDE_TEXT_MAX.heading`, 60): cut at a word, not inside one.
      jsonb_build_object('postId', new.id, 'title', case when char_length(new.idea) <= 60 then new.idea
          else left(coalesce(nullif(rtrim(regexp_replace(left(new.idea, 61), '\s+\S*$', '')), ''), new.idea), 60) end,
        'platform', v_profile,
        'done_when', 'The post''s schedule card shows the image.'),
      0, null, '{}', 'event');
  exception when others then
    -- An image is never a reason to undo the founder's approval of the post.
    raise warning 'post image rule failed for content item %: %', new.id, sqlerrm;
  end;
  return new;
end;
$_$;

-- The founder's photos for a text post, in order. `p_previous` is the list the card showed: a card older than the
-- post (another tab, a slow upload) is refused instead of overwriting it. A photo dropped from the list is queued for
-- deletion. In review, the `approvals_sync` trigger raises the post card again with the photos; approved, its schedule
-- cards go back to the founder, a failed one included, as a new image does. While a slot is posting, nothing changes.
drop function if exists public.post_photos_save(uuid, text[]);
create or replace function public.post_photos_save(p_item uuid, p_photos text[], p_previous text[] default null)
returns public.content_items
language plpgsql security definer set search_path = public, storage as $$
declare
  v_user uuid := public.require_user();
  v_row public.content_items;
  v_photos text[] := coalesce(p_photos, '{}');
  v_slot public.schedule_slots;
begin
  select * into v_row from public.content_items where id = p_item and user_id = v_user and department = 'post' for update;
  if not found then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  if v_row.status not in ('in_review', 'approved') then
    raise exception '%', case when v_row.status = 'published' then 'This post is already posted; its photos cannot change.'
      else 'Add photos once the post is written.' end using errcode = 'P0001';
  end if;
  if p_previous is not null and p_previous is distinct from v_row.photos then
    raise exception 'The photos of this post changed elsewhere. Reload the card and try again.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
             where d.ref_kind = 'content_item' and d.ref_id = p_item and s.status in ('due', 'reminded', 'publishing')) then
    raise exception 'This post is being posted right now; its photos cannot change.' using errcode = 'P0001';
  end if;
  if cardinality(v_photos) > 4 then
    raise exception 'A post takes up to 4 photos.' using errcode = '22023';
  end if;
  if (select count(distinct p) from unnest(v_photos) p) <> cardinality(v_photos) then
    raise exception 'The same photo is in the post twice.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_photos) p
             where p not like v_user::text || '/' || p_item::text || '/%'
                or not exists (select 1 from storage.objects o where o.bucket_id = 'photos' and o.name = p))
     or exists (select 1 from public.storage_deletions where bucket = 'photos' and path = any (v_photos)) then
    raise exception 'A photo is missing. Upload it again.' using errcode = '22023';
  end if;
  if v_photos = v_row.photos then
    return v_row;
  end if;
  insert into public.storage_deletions (bucket, path, user_id)
  select 'photos', p, v_user from unnest(v_row.photos) p where p <> all (v_photos)
  on conflict (bucket, path) do nothing;
  update public.content_items set photos = v_photos, updated_at = now() where id = p_item returning * into v_row;
  if v_row.status = 'approved' then
    perform public.schedule_image_changed(p_item);
    -- A failed slot waiting on its Retry card posts the new photos only after the founder sees them.
    for v_slot in
      select s.* from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
      where d.ref_kind = 'content_item' and d.ref_id = p_item and s.status = 'failed'
        and exists (select 1 from public.approvals a where a.ref_kind = 'schedule_slot' and a.ref_id = s.id and a.status = 'waiting')
    loop
      perform public.approval_raise(v_slot.user_id, 'schedule_slot', v_slot.id);
    end loop;
  end if;
  return v_row;
end;
$$;
revoke all on function public.post_photos_save(uuid, text[], text[]) from public, anon;
grant execute on function public.post_photos_save(uuid, text[], text[]) to authenticated;

-- Photos nothing will post: a text post's upload never saved, the photos of a post skipped or gone, a photo post's
-- leftovers. Older than p_days, so an upload in progress is never touched; a draft photo post's folder is left to
-- `photo_drafts_sweep`; a photo a live post or a scheduled photo post lists is never queued.
create or replace function public.post_photos_sweep(p_days integer default 7) returns integer
language plpgsql security definer set search_path = public, storage as $$
declare
  v_n integer;
begin
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'p_days must be between 1 and 365.' using errcode = '22023';
  end if;
  insert into public.storage_deletions (bucket, path, user_id)
  select 'photos', o.name, f.id
  from storage.objects o
  join public.profiles f on f.id::text = (storage.foldername(o.name))[1]
  where o.bucket_id = 'photos' and o.created_at < now() - make_interval(days => p_days)
    and not exists (select 1 from public.photo_posts p
                    where p.id::text = (storage.foldername(o.name))[2] and p.status = 'draft')
    and not exists (select 1 from public.photo_posts p where p.status = 'scheduled' and o.name = any (p.photos))
    and not exists (select 1 from public.content_items c
                    where c.id::text = (storage.foldername(o.name))[2] and c.status not in ('skipped', 'failed')
                      and o.name = any (c.photos))
    and not exists (select 1 from public.storage_deletions d where d.bucket = 'photos' and d.path = o.name)
  limit 1000
  on conflict (bucket, path) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.post_photos_sweep(integer) from public, anon, authenticated;
grant execute on function public.post_photos_sweep(integer) to service_role;
