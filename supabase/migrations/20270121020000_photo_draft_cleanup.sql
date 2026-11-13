-- Photo drafts are cleaned up (decision F3 of docs/plans/cmo/2026-11-13-core-drafts-followups-plan.md). The photos of
-- an abandoned photo post stayed in Storage and counted toward the plan's storage with no way to remove them.
--
-- `photo_draft_release` queues a draft's photos in `storage_deletions`, never one a scheduled post lists. Starting a
-- photo post again releases the draft it empties; a save releases the photos dropped from the list; the cleanup cron
-- closes drafts untouched for 7 days (`photo_drafts_sweep`) and releases them. Drafts closed before this migration are
-- released once, at its end.
--
-- The photos stay in Supabase Storage (bucket `photos`) for now: uploads move to DigitalOcean storage later this week.

-- p_photos null: every object under the draft's folder, uploaded and listed or not.
create or replace function public.photo_draft_release(p_post uuid, p_photos text[] default null) returns integer
language plpgsql security definer set search_path = public, storage as $$
declare
  v_row public.photo_posts;
  v_n integer;
begin
  -- Locked first, so the statement below sees a post scheduled meanwhile in another tab as scheduled.
  select * into v_row from public.photo_posts where id = p_post for update;
  -- Only a draft is ever cancelled, so a cancelled post is an abandoned draft whose photos may go too.
  if not found or v_row.status not in ('draft', 'cancelled') then
    return 0;
  end if;
  insert into public.storage_deletions (bucket, path, user_id)
  select 'photos', o.name, v_row.user_id from storage.objects o
  where o.bucket_id = 'photos'
    and o.name like v_row.user_id::text || '/' || v_row.id::text || '/%'
    and (p_photos is null or o.name = any (p_photos))
    -- A photo of a scheduled post is never deleted, whichever post it was uploaded for.
    and not exists (select 1 from public.photo_posts s where s.status = 'scheduled' and o.name = any (s.photos))
  on conflict (bucket, path) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.photo_draft_release(uuid, text[]) from public, anon, authenticated;

create or replace function public.photo_post_create() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':photo_post', 1719));
  -- Locked: a draft scheduled meanwhile in another tab is not emptied, and its photos are not released.
  select id into v_id from public.photo_posts where user_id = v_user and status = 'draft' order by created_at desc limit 1
  for update;
  if v_id is not null then
    -- Starting again empties the draft: its photos are deleted (F3), so they stop counting toward storage.
    perform public.photo_draft_release(v_id);
    update public.photo_posts set photos = '{}', caption = '', platforms = '{}', updated_at = now() where id = v_id;
    -- Drafts left over from before this rule are closed, so they stop counting.
    perform public.photo_draft_release(id) from public.photo_posts
    where user_id = v_user and status = 'draft' and id <> v_id;
    update public.photo_posts set status = 'cancelled', updated_at = now()
    where user_id = v_user and status = 'draft' and id <> v_id;
    return v_id;
  end if;
  insert into public.photo_posts (user_id) values (v_user) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.photo_post_save(p_id uuid, p_photos text[], p_caption text, p_platforms text[]) RETURNS public.photo_posts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'storage'
    AS $$
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
  if v_row.status = 'cancelled' then
    raise exception 'This draft was closed. Start a new photo post.' using errcode = 'P0001';
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
  -- A photo already queued for deletion is as good as gone: the cleanup would delete it under a scheduled post.
  if exists (select 1 from public.storage_deletions where bucket = 'photos' and path = any (v_photos)) then
    raise exception 'A photo is missing. Upload it again.' using errcode = '22023';
  end if;
  -- A photo dropped from the list is deleted.
  perform public.photo_draft_release(p_id, array(select p from unnest(v_row.photos) p where p <> all (v_photos)));
  update public.photo_posts set photos = v_photos, caption = coalesce(p_caption, ''), platforms = v_platforms, updated_at = now()
  where id = p_id returning * into v_row;
  return v_row;
end;
$$;

-- A draft is abandoned when neither the draft nor a photo of it changed for p_days: an upload does not touch the row.
create or replace function public.photo_drafts_sweep(p_days integer default 7) returns integer
language plpgsql security definer set search_path = public, storage as $$
declare
  v_since timestamptz;
  v_id uuid;
  v_n integer := 0;
begin
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'p_days must be between 1 and 365.' using errcode = '22023';
  end if;
  v_since := now() - make_interval(days => p_days);
  for v_id in
    select p.id from public.photo_posts p
    where p.status = 'draft' and p.updated_at < v_since
      and not exists (select 1 from storage.objects o where o.bucket_id = 'photos'
        and o.name like p.user_id::text || '/' || p.id::text || '/%' and o.created_at >= v_since)
    order by p.updated_at
    limit 500
    for update of p skip locked
  loop
    perform public.photo_draft_release(v_id);
    update public.photo_posts set status = 'cancelled', updated_at = now() where id = v_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.photo_drafts_sweep(integer) from public, anon, authenticated;
grant execute on function public.photo_drafts_sweep(integer) to service_role;

-- A draft the sweep closed, or one started again elsewhere, says so instead of "already scheduled".
create or replace function public.photo_post_schedule(p_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
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
  if v_row.status = 'cancelled' then
    raise exception 'This draft was closed. Start a new photo post.' using errcode = 'P0001';
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

-- Drafts closed before this migration still hold their photos: release them once.
select public.photo_draft_release(id) from public.photo_posts where status = 'cancelled';
