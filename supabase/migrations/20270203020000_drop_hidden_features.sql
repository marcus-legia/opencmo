-- Wave 4b A3 (plan docs/plans/cmo/2026-11-20-wave4-plan.md, item 7): the SQL used only by what wave 4b deleted from
-- the app: photo posts, slideshows and post images built by Studio, the scripts a founder records, niche video research,
-- and TikTok and Instagram captions. Runs AFTER the code without them is in production.
--
-- Functions shared with what stays (approval_decide, approval_snapshot, schedule_content, schedule_propose, the studio
-- order claim and settle) keep their branches for these kinds: nothing can create such a row any more, and the rows
-- already there are closed below, so the branches are never reached. Rewriting those large functions for dead
-- branches is a risk with no gain; they go when one of them is next changed for another reason.

-- 1. Nothing new: the removed CMO jobs are refused at enqueue (a limit of 0, like any unknown kind).
create or replace function public.cmo_job_daily_limit(p_kind text) returns integer
  language sql immutable
  set search_path to ''
as $$
  select case p_kind when 'plan_week' then 5 when 'post_draft' then 10 when 'sales_scan' then 3
    when 'competitor_research' then 2 when 'pull_metrics' then 2 when 'summarize_memory' then 1 when 'review_week' then 1
    when 'write_caption' then 20 when 'publish_post' then 100
    -- cmo-review-3 2.2: one rating round a day (`cmo_rate_drafts`), with room for a retry.
    when 'distill_ratings' then 2
    when 'repurpose_post' then 20
    when 'sales_reply_drafts' then 5
    else 0 end
$$;

-- Captions are YouTube's only: TikTok and Instagram are no longer platforms (packages/contracts/platforms.json).
create or replace function public.caption_profiles() returns text[]
  language sql immutable
  set search_path to ''
as $$ select array['youtube'] $$;

create or replace function public.platform_profile(p_id text) returns jsonb
  language sql immutable
  set search_path to 'public'
as $$
  select case p_id
    when 'x' then '{"kind": "post", "limit": 4000, "title": null, "hashtags": 0, "label": "X"}'::jsonb
    when 'threads' then '{"kind": "post", "limit": 500, "title": null, "hashtags": 0, "label": "Threads"}'::jsonb
    when 'linkedin' then '{"kind": "post", "limit": 3000, "title": null, "hashtags": 0, "label": "LinkedIn"}'::jsonb
    when 'facebook' then '{"kind": "post", "limit": 4000, "title": null, "hashtags": 0, "label": "Facebook"}'::jsonb
    when 'core' then '{"kind": "core", "limit": 3000, "title": null, "hashtags": 0, "label": "Post"}'::jsonb
    when 'youtube' then '{"kind": "youtube", "limit": 5000, "title": 100, "hashtags": 3, "label": "YouTube title and description"}'::jsonb
  end
$$;

create or replace function public.platform_profile_id(p_label text) returns text
  language sql immutable
  set search_path to 'public'
as $$
  select case lower(trim(coalesce(p_label, '')))
    when 'x' then 'x'
    when 'twitter' then 'x'
    when 'threads' then 'threads'
    when 'linkedin' then 'linkedin'
    when 'facebook' then 'facebook'
    when 'youtube' then 'youtube'
    when 'shorts' then 'youtube'
    when 'youtube shorts' then 'youtube'
    else null end
$$;

-- A caption for a removed platform is refused in plain words.
create or replace function public.caption_check(p_profile text, p_text text, p_title text) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
declare
  v_profile jsonb := public.platform_profile(p_profile);
  v_label text := v_profile->>'label';
  v_tags integer;
begin
  if v_profile is null or v_profile->>'kind' not in ('caption', 'youtube') then
    raise exception 'Captions are for YouTube.' using errcode = '22023';
  end if;
  if p_text is null or char_length(trim(p_text)) = 0 or char_length(p_text) > (v_profile->>'limit')::integer then
    raise exception 'A % is 1 to % characters.', v_label, to_char((v_profile->>'limit')::integer, 'FM999,999') using errcode = '22023';
  end if;
  if v_profile->>'kind' = 'youtube' then
    if p_title is null or char_length(trim(p_title)) = 0 or char_length(p_title) > (v_profile->>'title')::integer then
      raise exception 'A YouTube title is 1 to % characters.', v_profile->>'title' using errcode = '22023';
    end if;
  elsif p_title is not null then
    raise exception 'Only YouTube has a title.' using errcode = '22023';
  end if;
  if concat_ws(' ', p_title, p_text) ~* '(https?://|www\.|\m[a-z0-9][a-z0-9-]*\.(?!(jsx?|tsx?|mjs|py|rb|css|html?|md|json|ya?ml|txt|sql|vue|svelte)/)[a-z]{2,}/[^[:space:]])' then
    raise exception 'Captions carry no links.' using errcode = '22023';
  end if;
  -- `countHashtags` in lib/cmo/platforms.ts: `#word` with a letter in it, not `#1` or `a#b`.
  select count(*) into v_tags
  from regexp_matches(concat_ws(' ', p_title, p_text), '(^|[^[:alnum:]_&/])#[[:alnum:]_]*[[:alpha:]][[:alnum:]_]*', 'g');
  if v_tags > (v_profile->>'hashtags')::integer then
    raise exception 'A % carries at most % hashtags.', v_label, v_profile->>'hashtags' using errcode = '22023';
  end if;
end;
$$;

-- 2. What was waiting closes: the cards of the deleted kinds, and slots that would still post to TikTok or Instagram
-- or a photo post. Finished rows stay as history.
update public.approvals set status = 'cancelled', decided_at = now()
where status in ('waiting', 'held')
  and (kind = 'slideshow' or (kind = 'script' and snapshot->>'tool' = 'script_item'));

update public.approvals a set status = 'cancelled', decided_at = now()
from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
where a.ref_kind = 'schedule_slot' and a.ref_id = s.id and a.status in ('waiting', 'held')
  and (s.platform in ('tiktok', 'instagram') or d.kind in ('photo_post', 'slideshow'));

update public.schedule_slots s set status = 'cancelled'
from public.deliverables d
where d.id = s.deliverable_id and s.status in ('waiting', 'due', 'reminded')
  and (s.platform in ('tiktok', 'instagram') or d.kind in ('photo_post', 'slideshow'));

update public.work_orders set status = 'cancelled'
where kind in ('build_slideshow', 'build_post_image', 'write_video_brief', 'write_slides', 'niche_video_research')
  and status in ('queued', 'running', 'deferred', 'waiting_order', 'waiting_founder');

update public.cmo_runs set status = 'failed', error = 'This task is no longer part of Ferreto.'
where kind in ('write_video_brief', 'niche_video_research', 'photo_caption', 'write_slides') and status in ('queued', 'running', 'deferred');

-- 3. Photo posts: the rows are kept in a legacy table no founder can read (support can), then the table goes.
create table public.legacy_photo_posts as select * from public.photo_posts;
alter table public.legacy_photo_posts enable row level security;
revoke all on public.legacy_photo_posts from public, anon, authenticated;

drop function public.photo_post_create();
drop function public.photo_post_save(uuid, text[], text, text[]);
drop function public.photo_post_caption(uuid, text);
drop function public.photo_post_schedule(uuid);
drop function public.photo_post_check(integer, text[]);
drop function public.photo_draft_release(uuid, text[]);
drop function public.photo_drafts_sweep(integer);
drop function public.cmo_save_photo_caption(uuid, uuid, uuid, text);

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
  -- A photo of a text post (20270121040000): a JPEG or PNG of 10 MB at most, under a post of the founder's that is in
  -- review or approved. Photo posts were deleted in wave 4b.
  if p_bucket = 'photos' then
    if p_size is null or p_size <= 0 or p_size > 10485760
       or coalesce(p_content_type, '') not in ('image/jpeg', 'image/png', 'image/webp') then
      raise exception 'Use a JPEG, PNG or WebP photo of 10 MB at most.' using errcode = '22023';
    end if;
    if p_project_id is null or array_length(v_parts, 1) <> 3 or v_parts[1] is distinct from v_user::text
       or v_parts[2] is distinct from p_project_id::text
       or not exists (select 1 from public.content_items where id = p_project_id and user_id = v_user
                        and department = 'post' and status in ('in_review', 'approved')) then
      raise exception 'Post not found.' using errcode = 'P0002';
    end if;
    -- A text post's photos go to every platform of its slot, and Threads and LinkedIn do not take WebP.
    if p_content_type = 'image/webp' then
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

create or replace function public.post_photos_sweep(p_days integer DEFAULT 7) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'storage'
    AS $$
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

drop table public.photo_posts;

-- 4. Slideshows and post images built by Studio (the editor's own slideshows, `create_slideshow`, stay).
drop trigger if exists studio_slideshow_fresh on public.studio_steps;
drop function public.studio_slideshow_fresh();
drop function public.studio_slideshow_rendering(uuid, uuid, jsonb, jsonb, uuid, uuid);
drop function public.studio_slideshow_rerender(uuid, uuid, uuid, jsonb);
drop function public.studio_slideshow_settle(uuid);
drop trigger if exists content_items_post_image on public.content_items;
drop function public.content_items_post_image();
drop function public.create_post_image_edit(text, text, uuid);
drop function public.studio_post_image_rendering(uuid, uuid, uuid, uuid);
drop function public.studio_post_image_settle(uuid);
drop function public.request_stills_export(uuid, uuid, uuid);
drop function public.cmo_drop_write_slides();

-- 5. The scripts a founder records: ordered from the chat and opened from Writer, both gone.
drop function public.cmo_order_script(text, date);
drop function public.cmo_script_open(uuid);
