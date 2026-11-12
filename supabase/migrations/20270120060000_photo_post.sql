-- Photo post (daily core drafts D7, owner 2026-11-12; plan Task 9): the founder uploads their own photos, orders them,
-- gets a caption from the CMO on request, picks platforms, and each platform gets one schedule slot. TikTok posts it in
-- Photo Mode (up to 35 photos), Instagram and Threads as a carousel (up to 20). Nothing here is built by the CMO.
--
-- Photos go straight from the browser to the private `photos` bucket through TUS with a reservation (never through
-- Next.js); the slot posts them from short-lived signed URLs. A photo post needs a connected account on every platform
-- it goes to: none of the three takes photos from a link or a composer.

-- ------------------------------------------------------------------ Table

create table if not exists public.photo_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  photos text[] not null default '{}',
  caption text not null default '',
  platforms text[] not null default '{}',
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint photo_posts_status_check check (status in ('draft', 'scheduled', 'cancelled')),
  constraint photo_posts_photos_check check (cardinality(photos) <= 35),
  constraint photo_posts_caption_check check (char_length(caption) <= 2200),
  constraint photo_posts_platforms_check check (platforms <@ array['tiktok', 'instagram', 'threads'])
);
create index if not exists photo_posts_user_idx on public.photo_posts (user_id, created_at desc);

alter table public.photo_posts enable row level security;
drop policy if exists "read own photo posts" on public.photo_posts;
create policy "read own photo posts" on public.photo_posts for select to authenticated
  using (user_id = (select auth.uid()));
-- Writes go through the RPCs below only.
revoke all on public.photo_posts from public, anon, authenticated;
grant select on public.photo_posts to authenticated;
grant select, insert, update, delete on public.photo_posts to service_role;

-- ------------------------------------------------------------------ Bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "upload reserved photos" on storage.objects;
create policy "upload reserved photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.upload_reservation_allows(bucket_id, name, metadata));
drop policy if exists "read own photos" on storage.objects;
create policy "read own photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter table public.upload_reservations drop constraint if exists upload_reservations_bucket_check;
alter table public.upload_reservations add constraint upload_reservations_bucket_check
  check (bucket in ('sources', 'media', 'exports', 'photos'));
alter table public.upload_reservations drop constraint if exists upload_reservations_content_type_check;
alter table public.upload_reservations add constraint upload_reservations_content_type_check
  check (content_type like 'video/%' or (bucket = 'photos' and content_type in ('image/jpeg', 'image/png', 'image/webp')));

alter table public.storage_deletions drop constraint if exists storage_deletions_bucket_check;
alter table public.storage_deletions add constraint storage_deletions_bucket_check
  check (bucket in ('clips', 'sources', 'renders', 'media', 'exports', 'brand', 'photos'));

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
  -- A photo of a photo post (20270120060000): a JPEG, PNG or WebP of 10 MB at most, under the founder's draft.
  if p_bucket = 'photos' then
    if p_size is null or p_size <= 0 or p_size > 10485760
       or coalesce(p_content_type, '') not in ('image/jpeg', 'image/png', 'image/webp') then
      raise exception 'Use a JPEG, PNG or WebP photo of 10 MB at most.' using errcode = '22023';
    end if;
    if p_project_id is null or array_length(v_parts, 1) <> 3 or v_parts[1] is distinct from v_user::text
       or v_parts[2] is distinct from p_project_id::text
       or not exists (select 1 from public.photo_posts where id = p_project_id and user_id = v_user and status = 'draft') then
      raise exception 'Photo post not found.' using errcode = 'P0002';
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

create or replace function public.upload_usage() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'storage'
    AS $$
declare
  v_user uuid := public.require_user(); v_plan text; v_limits record;
  v_bytes bigint; v_objects bigint;
begin
  select coalesce(plan, 'free') into v_plan from public.profiles where id = v_user;
  select * into v_limits from public.plan_usage_limits(v_plan);
  select coalesce(sum(coalesce((metadata->>'size')::bigint, 0)), 0), count(*)
    into v_bytes, v_objects from storage.objects
    where bucket_id in ('sources','media','exports','photos')
      and (storage.foldername(name))[1] = v_user::text;
  return jsonb_build_object('bytes', v_bytes, 'limit', v_limits.stored_bytes,
    'objects', v_objects, 'objectLimit', v_limits.stored_objects);
end;
$$;


-- ------------------------------------------------------------------ Rules and the founder's RPCs

-- What each platform takes: TikTok Photo Mode up to 35 photos, an Instagram or Threads carousel up to 20.
create or replace function public.photo_post_check(p_count integer, p_platforms text[]) returns void
language plpgsql immutable set search_path = public
as $$
begin
  if 'tiktok' = any (p_platforms) and p_count > 35 then
    raise exception 'TikTok takes up to 35 photos.' using errcode = '22023';
  end if;
  if 'instagram' = any (p_platforms) and p_count > 20 then
    raise exception 'Instagram takes up to 20 photos.' using errcode = '22023';
  end if;
  if 'threads' = any (p_platforms) and p_count > 20 then
    raise exception 'Threads takes up to 20 photos.' using errcode = '22023';
  end if;
  if p_count > 35 then
    raise exception 'A photo post has 35 photos at most.' using errcode = '22023';
  end if;
  if not (coalesce(p_platforms, '{}') <@ array['tiktok', 'instagram', 'threads']) then
    raise exception 'A photo post goes to TikTok, Instagram or Threads.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.photo_post_check(integer, text[]) from public, anon, authenticated;

create or replace function public.photo_post_create() returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_id uuid;
begin
  -- Drafts left open are reused rather than piled up: at most five at a time.
  if (select count(*) from public.photo_posts where user_id = v_user and status = 'draft') >= 5 then
    raise exception 'Finish or remove a photo post you started before making another.' using errcode = 'P0001';
  end if;
  insert into public.photo_posts (user_id) values (v_user) returning id into v_id;
  return v_id;
end;
$$;

-- The photos (in the founder's order), the caption and the platforms. Each photo must be the founder's upload under
-- this post's folder.
create or replace function public.photo_post_save(p_id uuid, p_photos text[], p_caption text, p_platforms text[])
returns public.photo_posts
language plpgsql security definer set search_path = public, storage
as $$
declare
  v_user uuid := public.require_user();
  v_row public.photo_posts;
  v_photos text[] := coalesce(p_photos, '{}');
  v_platforms text[] := array(select distinct p from unnest(coalesce(p_platforms, '{}')) p order by p);
begin
  select * into v_row from public.photo_posts where id = p_id and user_id = v_user for update;
  if not found then
    raise exception 'Photo post not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'This photo post is already scheduled.' using errcode = 'P0001';
  end if;
  perform public.photo_post_check(cardinality(v_photos), v_platforms);
  if (select count(distinct p) from unnest(v_photos) p) <> cardinality(v_photos) then
    raise exception 'The same photo is in the post twice.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_photos) p
             where p not like v_user::text || '/' || p_id::text || '/%'
                or not exists (select 1 from storage.objects o where o.bucket_id = 'photos' and o.name = p)) then
    raise exception 'A photo is missing. Upload it again.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_caption, '')) > 2200 then
    raise exception 'A caption is 2,200 characters at most.' using errcode = '22023';
  end if;
  update public.photo_posts set photos = v_photos, caption = coalesce(p_caption, ''), platforms = v_platforms, updated_at = now()
  where id = p_id returning * into v_row;
  return v_row;
end;
$$;

-- Schedule it: one slot per platform, each with its own schedule card (time, account, TikTok's settings).
create or replace function public.photo_post_schedule(p_id uuid) returns integer
language plpgsql security definer set search_path = public
as $$
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

-- "Write the caption" (1 credit, held before the model runs): the founder's words and the number of photos.
create or replace function public.photo_post_caption(p_id uuid, p_notes text) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_row public.photo_posts;
  v_run public.cmo_runs;
begin
  select * into v_row from public.photo_posts where id = p_id and user_id = v_user;
  if not found then
    raise exception 'Photo post not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'This photo post is already scheduled.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_notes, ''))) not between 3 and 1000 then
    raise exception 'Say in a few words what the photos show (3 to 1,000 characters).' using errcode = '22023';
  end if;
  v_run := public.cmo_enqueue(v_user, 'photo_caption',
    jsonb_build_object('photo_post_id', p_id, 'notes', btrim(p_notes), 'photos', cardinality(v_row.photos)));
  return jsonb_build_object('run_id', v_run.id, 'status', v_run.status, 'credits', v_run.credits);
end;
$$;

-- The runner saves the caption it wrote, under the caption rules; only a draft takes it.
create or replace function public.cmo_save_photo_caption(p_user uuid, p_run uuid, p_id uuid, p_caption text)
returns public.photo_posts
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.photo_posts;
  v_text text := btrim(coalesce(p_caption, ''), E' \t\n\r');
begin
  if not exists (select 1 from public.cmo_runs where id = p_run and user_id = p_user and kind = 'photo_caption') then
    raise exception 'Run not found.' using errcode = 'P0002';
  end if;
  perform public.caption_check('instagram_caption', v_text, null);
  update public.photo_posts set caption = v_text, updated_at = now()
  where id = p_id and user_id = p_user and status = 'draft'
  returning * into v_row;
  if not found then
    raise exception 'This photo post can no longer take a caption.' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

revoke all on function public.photo_post_create() from public, anon;
revoke all on function public.photo_post_save(uuid, text[], text, text[]) from public, anon;
revoke all on function public.photo_post_schedule(uuid) from public, anon;
revoke all on function public.photo_post_caption(uuid, text) from public, anon;
revoke all on function public.cmo_save_photo_caption(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.photo_post_create() to authenticated;
grant execute on function public.photo_post_save(uuid, text[], text, text[]) to authenticated;
grant execute on function public.photo_post_schedule(uuid) to authenticated;
grant execute on function public.photo_post_caption(uuid, text) to authenticated;
grant execute on function public.cmo_save_photo_caption(uuid, uuid, uuid, text) to service_role;

-- ------------------------------------------------------------------ Deliverable, slots, what goes out

alter table public.deliverables drop constraint if exists deliverables_kind_check;
alter table public.deliverables add constraint deliverables_kind_check check (kind in ('post', 'caption', 'video', 'short',
  'slideshow', 'image', 'reply', 'insight', 'metric', 'photo_post'));
alter table public.deliverables drop constraint if exists deliverables_ref_kind_check;
alter table public.deliverables add constraint deliverables_ref_kind_check
  check (ref_kind in ('content_item', 'opportunity', 'insight', 'clip', 'photo_post'));

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
begin
  select * into v_d from public.deliverables where id = p_deliverable;
  if not found then
    return null;
  end if;
  if v_d.ref_kind = 'content_item' then
    select coalesce(body->>'text', ''), case when public.thread_valid(body) then body->'thread' end
    into v_text, v_thread from public.content_items where id = v_d.ref_id;
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
    return jsonb_build_object('clip_id', null, 'text', v_text, 'title', null,
      'content_hash', public.approval_hash(jsonb_build_object('text', v_text)
        || case when v_image is not null then jsonb_build_object('image', v_image->>'object') else '{}'::jsonb end
        || case when v_thread is not null then jsonb_build_object('thread', v_thread) else '{}'::jsonb end))
      || case when v_image is not null then jsonb_build_object('image', v_image) else '{}'::jsonb end
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


-- ------------------------------------------------------------------ The caption job

alter table public.cmo_runs drop constraint if exists cmo_runs_kind_check;
alter table public.cmo_runs add constraint cmo_runs_kind_check check (kind = any (array['onboard', 'plan_week', 'post_draft',
  'sales_scan', 'competitor_research', 'pull_metrics', 'summarize_memory', 'review_week', 'write_caption', 'write_video_brief',
  'write_slides', 'publish_post', 'niche_video_research', 'distill_ratings', 'repurpose_post', 'photo_caption']));

create or replace function public.cmo_job_price(p_kind text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select case p_kind when 'plan_week' then 1 when 'post_draft' then 1 when 'sales_scan' then 5
    when 'competitor_research' then 2 when 'pull_metrics' then 0 when 'summarize_memory' then 0 when 'review_week' then 0
    when 'write_caption' then 1 when 'write_video_brief' then 1 when 'write_slides' then 1 when 'publish_post' then 0 when 'niche_video_research' then 2
    when 'repurpose_post' then 1
    when 'photo_caption' then 1
    else 0 end
$$;

create or replace function public.cmo_job_daily_limit(p_kind text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select case p_kind when 'plan_week' then 5 when 'post_draft' then 10 when 'sales_scan' then 3
    when 'competitor_research' then 2 when 'pull_metrics' then 2 when 'summarize_memory' then 1 when 'review_week' then 1
    when 'write_caption' then 20 when 'write_video_brief' then 5 when 'write_slides' then 10 when 'publish_post' then 100 when 'niche_video_research' then 2
    -- cmo-review-3 2.2: one rating round a day (`cmo_rate_drafts`), with room for a retry.
    when 'distill_ratings' then 2
    when 'repurpose_post' then 20
    when 'photo_caption' then 20
    else 0 end
$$;

create or replace function public.enqueue_cmo_run(p_kind text, p_input jsonb DEFAULT '{}'::jsonb) RETURNS public.cmo_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- Posting is ordered only by Schedule, for a slot whose card the founder approved.
  -- The schedule's own jobs are free and spend provider money (the planner model, ScrapeCreators): only the schedule
  -- queues them (enqueue_cmo_run_for), never a direct call (review R5).
  if p_kind in ('publish_post', 'review_week', 'pull_metrics', 'summarize_memory', 'distill_ratings', 'repurpose_post', 'photo_caption') then
    raise exception 'Unknown task.' using errcode = '22023';
  end if;
  return public.cmo_enqueue(public.require_user(), p_kind, p_input);
end;
$$;

-- ------------------------------------------------------------------ Rate limit of the photo uploads

create or replace function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_bucket text;
  v_plan text;
  v_quota record;
  v_expected int;
  v_window_start timestamptz;
  v_legacy_count int := 0;
  v_count int;
  v_allowed boolean := false;
begin
  v_bucket := case p_bucket
    when 'daily_preview' then 'preview'
    when 'daily_export' then 'export'
    else p_bucket
  end;

  if v_bucket in ('preview', 'export') then
    select coalesce(plan, 'free') into v_plan
    from public.profiles where id = v_user;
    select * into v_quota from public.plan_quota(v_plan);
    v_expected := case
      when v_bucket = 'preview' then v_quota.previews_per_day
      else v_quota.exports_per_day
    end;
    v_allowed := p_limit = v_expected and p_window_seconds = 86400;
    if p_bucket = 'preview' and p_limit = 2 and p_window_seconds = 60 then
      v_allowed := true;
    end if;
  else
    v_allowed := (p_bucket = 'presets' and p_limit = 60 and p_window_seconds = 3600)
      -- Creem checkout and portal links: each call reaches Creem.
      or (p_bucket = 'billing_checkout' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'billing_portal' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'uploads' and p_limit = 30 and p_window_seconds = 3600)
      -- A photo post's photos (20270120060000): up to 35 in one post, one reservation each.
      or (p_bucket = 'photo-uploads' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'jobs' and p_limit = 10 and p_window_seconds = 3600)
      or (p_bucket = 'retry' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'project-write' and p_limit = 60 and p_window_seconds = 3600)
      -- P4: connecting and disconnecting social accounts (each call reaches Zernio).
      or (p_bucket = 'accounts' and p_limit = 30 and p_window_seconds = 3600)
      -- P4: moving a slot on the calendar and "I posted it" (`/api/v1/schedule/slots/[id]`).
      or (p_bucket = 'schedule' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'editor-write' and p_limit = 240 and p_window_seconds = 60)
      or (p_bucket = 'media' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'scene_codes' and p_limit = 300 and p_window_seconds = 3600)
      or (p_bucket = 'feedback' and p_limit = 20 and p_window_seconds = 3600)
      or (p_bucket = 'mcp_preview' and p_limit = 60 and p_window_seconds = 3600)
      -- POST /api/v1/generations: each request can run a paid moderation call.
      or (p_bucket = 'generations' and p_limit = 120 and p_window_seconds = 3600)
      -- `create_generation` itself: a direct PostgREST call skips the route's bucket.
      or (p_bucket = 'generation_create' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'mcp_look' and p_limit = 60 and p_window_seconds = 3600)
      -- Review R4 (20270102020000): routes that had no limit of their own.
      or (p_bucket = 'agent-turn' and p_limit = 120 and p_window_seconds = 3600)
      or (p_bucket = 'agent-continue' and p_limit = 300 and p_window_seconds = 3600)
      or (p_bucket = 'agent-session' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'captures' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'cmo-runs' and p_limit = 60 and p_window_seconds = 3600)
      or (p_bucket = 'onboarding' and p_limit = 20 and p_window_seconds = 3600)
      -- The CMO chat's thumbs (20270103010000).
      or (p_bucket = 'feedback-turn' and p_limit = 60 and p_window_seconds = 3600);
  end if;

  if not v_allowed then
    raise exception 'Invalid rate limit.' using errcode = '22023';
  end if;

  -- The short preview/export window counts in its own row: in the first minute after UTC
  -- midnight the 60-second and the daily window share a `window_start`, and used to add up
  -- into the daily quota (CI red at 00:00:24 UTC on 04/10).
  if v_bucket in ('preview', 'export') and p_window_seconds <> 86400 then
    v_bucket := v_bucket || ':' || p_window_seconds;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  if v_bucket in ('preview', 'export') and p_window_seconds = 86400 then
    select coalesce(max(count), 0) into v_legacy_count
    from public.rate_limits
      where user_id = v_user
      and bucket = 'daily_' || v_bucket
      and window_start = v_window_start;
  end if;

  insert into public.rate_limits(user_id, bucket, window_start, count)
  values(v_user, v_bucket, v_window_start, v_legacy_count + 1)
  on conflict (user_id, bucket, window_start)
  do update set count = greatest(public.rate_limits.count, v_legacy_count) + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;
