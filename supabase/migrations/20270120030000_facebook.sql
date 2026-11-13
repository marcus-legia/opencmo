-- Facebook Page (daily core drafts, owner 2026-11-12, D9; plan Task 5).
--
-- Facebook posts through Zernio to a Page the founder manages; Meta's API cannot post to a personal profile, so a
-- founder without a connected Page gets the same draft with copy and open. Facebook joins the text platforms of the
-- posting plan (ruling 1 of the plan's sessions README): the planner row, `save_posting_plan`'s keys, the post's
-- targets and the fan-out. Autopilot for Facebook stays off (`profiles_autopilot_platforms_check` is unchanged): the
-- owner widens it, not this migration.
--
-- Redeclares functions of 20261229090000 / 20261229100000 / 20261230100000 / 20270101120000 / 20270113010000 /
-- 20270120015000 / 20270120020000; `create or replace` keeps their grants.

-- ------------------------------------------------------------------ The platform checks

alter table public.social_accounts drop constraint if exists social_accounts_platform_check;
alter table public.social_accounts add constraint social_accounts_platform_check
  check (platform in ('x', 'threads', 'linkedin', 'facebook', 'tiktok', 'youtube', 'instagram'));
alter table public.schedule_slots drop constraint if exists schedule_slots_platform_check;
alter table public.schedule_slots add constraint schedule_slots_platform_check
  check (platform in ('x', 'threads', 'linkedin', 'facebook', 'tiktok', 'youtube', 'instagram'));
alter table public.account_metrics drop constraint if exists account_metrics_platform_check;
alter table public.account_metrics add constraint account_metrics_platform_check
  check (platform in ('x', 'threads', 'linkedin', 'facebook', 'tiktok', 'youtube', 'instagram'));
alter table public.best_slots drop constraint if exists best_slots_platform_check;
alter table public.best_slots add constraint best_slots_platform_check
  check (platform in ('x', 'threads', 'linkedin', 'facebook', 'tiktok', 'youtube', 'instagram'));

-- ------------------------------------------------------------------ Profiles and labels (packages/contracts)

create or replace function public.platform_profile(p_id text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case p_id
    when 'x' then '{"kind": "post", "limit": 25000, "title": null, "hashtags": 0, "label": "X"}'::jsonb
    when 'threads' then '{"kind": "post", "limit": 500, "title": null, "hashtags": 0, "label": "Threads"}'::jsonb
    when 'linkedin' then '{"kind": "post", "limit": 3000, "title": null, "hashtags": 0, "label": "LinkedIn"}'::jsonb
    when 'facebook' then '{"kind": "post", "limit": 5000, "title": null, "hashtags": 0, "label": "Facebook"}'::jsonb
    when 'core' then '{"kind": "core", "limit": 3000, "title": null, "hashtags": 0, "label": "Post"}'::jsonb
    when 'instagram_caption' then '{"kind": "caption", "limit": 2200, "title": null, "hashtags": 5, "label": "Instagram caption"}'::jsonb
    when 'tiktok_caption' then '{"kind": "caption", "limit": 2200, "title": null, "hashtags": 5, "label": "TikTok caption"}'::jsonb
    when 'youtube' then '{"kind": "youtube", "limit": 5000, "title": 100, "hashtags": 3, "label": "YouTube title and description"}'::jsonb
  end
$$;

create or replace function public.platform_profile_id(p_label text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case lower(trim(coalesce(p_label, '')))
    when 'x' then 'x'
    when 'twitter' then 'x'
    when 'threads' then 'threads'
    when 'linkedin' then 'linkedin'
    when 'facebook' then 'facebook'
    when 'instagram' then 'instagram_caption'
    when 'instagram_caption' then 'instagram_caption'
    when 'reels' then 'instagram_caption'
    when 'tiktok' then 'tiktok_caption'
    when 'tiktok_caption' then 'tiktok_caption'
    when 'youtube' then 'youtube'
    when 'shorts' then 'youtube'
    when 'youtube shorts' then 'youtube'
    else null end
$$;

create or replace function public.schedule_platform_label(p_platform text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case p_platform when 'x' then 'X' when 'threads' then 'Threads' when 'linkedin' then 'LinkedIn' when 'facebook' then 'Facebook'
    when 'tiktok' then 'TikTok' when 'instagram' then 'Instagram' when 'youtube' then 'YouTube' else p_platform end
$$;

-- packages/contracts/schedule-defaults.json (lib/cmo/schedule-defaults.check.ts compares them).
create or replace function public.schedule_rules() RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$ select '{"minGapHours": 3, "windowMinutes": 15, "leadMinutes": 30, "horizonDays": 14, "maxProposals": 3, "jitterSeconds": 240, "platforms": {"x": {"times": ["09:00"], "dailyCap": 5}, "threads": {"times": ["09:00", "12:00"], "dailyCap": 2}, "linkedin": {"times": ["16:00"], "dailyCap": 1}, "facebook": {"times": ["09:00", "13:00"], "dailyCap": 2}, "tiktok": {"times": ["09:00", "13:00"], "dailyCap": 2}, "instagram": {"times": ["09:00"], "dailyCap": 1}, "youtube": {"times": ["16:00", "19:00"], "dailyCap": 2}}}'::jsonb $$;

create or replace function public.best_time_posts(p_user uuid) RETURNS TABLE(item_id uuid, platform text, hour smallint, views_per_hour double precision)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with r as (select public.best_time_rules() as j),
  latest as (
    select distinct on (m.item_id) m.item_id, greatest(m.views, m.impressions) as views, m.measured_at
    from public.post_metrics m
    where m.user_id = p_user
    order by m.item_id, m.measured_at desc
  )
  select p.item_id, public.slot_platform_of(p.platform),
    extract(hour from p.published_at at time zone public.schedule_timezone(p_user))::smallint,
    l.views / greatest(1.0, extract(epoch from l.measured_at - p.published_at) / 3600.0)
  from r, public.published_items(p_user, now() - make_interval(days => (r.j->>'windowDays')::integer)) p
  join latest l on l.item_id = p.item_id
  where l.views is not null
    and public.slot_platform_of(p.platform) in ('x', 'threads', 'linkedin', 'facebook', 'tiktok', 'youtube', 'instagram')
    and p.published_at <= now() - make_interval(hours => (r.j->>'settleHours')::integer)
$$;


-- ------------------------------------------------------------------ The post card's time, the posting plan, the fan-out

create or replace function public.post_proposal(p_user uuid, p_platform_label text, p_item uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_platform text := public.platform_profile_id(p_platform_label);
  v_at timestamptz;
  v_account public.social_accounts;
begin
  -- The same platforms `schedule_propose` gives a slot to.
  if v_platform is null or v_platform not in ('x', 'threads', 'linkedin', 'facebook') then
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

create or replace function public.post_proposal_snapshot(p_body jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
declare
  v_p jsonb := p_body->'proposed';
  v_publish boolean := v_p->>'mode' = 'publish';
begin
  if public.post_proposed_at(p_body) is null or v_p->>'platform' not in ('x', 'threads', 'linkedin', 'facebook')
     or v_p->>'mode' not in ('publish', 'intent') then
    return null;
  end if;
  return jsonb_build_object('platform', v_p->>'platform', 'at', v_p->>'at',
    'account_id', case when v_publish then v_p->>'account_id' end, 'mode', v_p->>'mode',
    'handle', case when v_publish then left(v_p->>'handle', 100) end);
end;
$$;

create or replace function public.posting_plan_targets(p_targets jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case
    when jsonb_typeof(p_targets) = 'array'
      and jsonb_array_length(p_targets) between 1 and 4
      and (select bool_and(jsonb_typeof(t) = 'string' and t #>> '{}' in ('x', 'threads', 'linkedin', 'facebook')) from jsonb_array_elements(p_targets) t)
      and (select count(distinct t) from jsonb_array_elements(p_targets) t) = jsonb_array_length(p_targets)
    then p_targets
    else null end
$$;

create or replace function public.save_posting_plan(p_plan jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_key text;
  v_val jsonb;
  v_slots jsonb[];
  v_n integer;
  v_most integer;
  v_old_text jsonb;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object'
     or jsonb_typeof(p_plan->'text') is distinct from 'object' or jsonb_typeof(p_plan->'video') is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_plan)) <> 2 then
    raise exception 'The posting plan needs a text and a video section.' using errcode = '22023';
  end if;

  if (select array_agg(k order by k) from jsonb_object_keys(p_plan->'text') k) is distinct from array['facebook', 'linkedin', 'threads', 'x'] then
    raise exception 'Posts a day are set for X, Threads, LinkedIn and Facebook.' using errcode = '22023';
  end if;
  for v_key, v_val in select * from jsonb_each(p_plan->'text') loop
    if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
       or (v_val #>> '{}')::numeric not between 0 and 3 then
      raise exception 'Posts a day must be between 0 and 3.' using errcode = '22023';
    end if;
  end loop;

  if (select array_agg(k order by k) from jsonb_object_keys(p_plan->'video') k) is distinct from array['instagram', 'tiktok', 'youtube'] then
    raise exception 'Videos a week are set for TikTok, Instagram and YouTube.' using errcode = '22023';
  end if;
  for v_key, v_val in select * from jsonb_each(p_plan->'video') loop
    if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
       or (v_val #>> '{}')::numeric not between 0 and 7 then
      raise exception 'Videos a week must be between 0 and 7.' using errcode = '22023';
    end if;
  end loop;

  select posting_plan->'text' into v_old_text from public.profiles where id = v_user for update;
  update public.profiles set posting_plan = p_plan where id = v_user;
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
  if v_old_text is not distinct from p_plan->'text' then
    return p_plan;
  end if;

  -- The day's slots as `dayTargets` builds them: slot i goes to every platform (in X, Threads, LinkedIn order) whose
  -- count is above i.
  v_most := greatest((p_plan->'text'->>'x')::int, (p_plan->'text'->>'threads')::int, (p_plan->'text'->>'linkedin')::int,
    (p_plan->'text'->>'facebook')::int);
  v_slots := array(
    select (select jsonb_agg(p order by o) from unnest(array['x', 'threads', 'linkedin', 'facebook']) with ordinality as u(p, o)
            where (p_plan->'text'->>p)::int > i)
    from generate_series(0, v_most - 1) i order by i);
  v_n := coalesce(array_length(v_slots, 1), 0);
  if v_n > 0 then
    update public.content_items c
    -- body.slot stays the planner's: a retarget that caps two posts onto one slot must not tie them for the next save.
    set body = c.body || jsonb_build_object('targets', v_slots[least(r.rank, v_n)]),
        platform = public.platform_profile(v_slots[least(r.rank, v_n)]->>0)->>'label',
        updated_at = now()
    from (
      select id, row_number() over (
               partition by day
               order by case when jsonb_typeof(body->'slot') = 'number' then (body->>'slot')::numeric end nulls last, created_at, id
             )::int as rank
      from public.content_items
      where user_id = v_user and department = 'post' and status = 'planned' and day > current_date
    ) r
    where c.id = r.id;
  end if;
  return p_plan;
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
    -- Every platform of the post's slot (Writer's old items: the one platform of their label).
    select array(select t from unnest(public.post_targets(c.id)) with ordinality as u(t, o)
                 where t in ('x', 'threads', 'linkedin', 'facebook') order by o)
      into v_platforms
    from public.content_items c where c.id = v_d.ref_id and c.status = 'approved';
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

create or replace function public.cmo_mark_posted(p_id uuid, p_url text DEFAULT NULL::text) RETURNS public.content_items
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_row public.content_items;
  v_url text := nullif(trim(coalesce(p_url, '')), '');
  v_profile text;
begin
  select * into v_row from public.content_items where id = p_id and user_id = v_user and status = 'approved' for update;
  if not found then
    raise exception 'Approve the post before marking it as posted.' using errcode = 'P0001';
  end if;
  v_profile := coalesce(public.platform_profile_id(v_row.platform), 'x');
  if public.platform_profile(v_profile)->>'kind' is distinct from 'post' then
    v_profile := 'x';
  end if;
  if v_url is not null then
    if v_profile = 'threads' and v_url !~ '^https://(www\.)?threads\.(net|com)/@[A-Za-z0-9_.]{1,30}/post/[A-Za-z0-9_-]{1,64}' then
      raise exception 'Paste the link to your post on Threads, like https://www.threads.com/@you/post/abc.' using errcode = '22023';
    elsif v_profile = 'linkedin'
      and v_url !~ '^https://(www\.)?linkedin\.com/(posts/[A-Za-z0-9_%.-]{1,255}|feed/update/urn:li:(activity|share|ugcPost):[0-9]{1,25})' then
      raise exception 'Paste the link to your post on LinkedIn, like https://www.linkedin.com/feed/update/urn:li:activity:123.' using errcode = '22023';
    elsif v_profile = 'facebook' and v_url !~ '^https://(www\.|m\.)?facebook\.com/[A-Za-z0-9_./?=&%-]{1,255}$' then
      raise exception 'Paste the link to your post on Facebook, like https://www.facebook.com/yourpage/posts/123.' using errcode = '22023';
    elsif v_profile = 'x' and v_url !~ '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{1,25}' then
      raise exception 'Paste the link to your post on X, like https://x.com/you/status/123.' using errcode = '22023';
    end if;
  end if;
  update public.content_items set status = 'published', external_url = v_url, published_at = now(), updated_at = now()
  where id = v_row.id
  returning * into v_row;
  insert into public.operation_log (user_id, platform, action, target) values (v_user, v_profile, 'publish', p_id::text)
  on conflict do nothing;
  return v_row;
end;
$$;
