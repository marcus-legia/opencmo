-- 20270101120000: P6 A2 (P2), the founder's own best hours (schedule-publish.md §5, §9).
--
-- Once a platform has ~10 published posts with numbers, `best_slots` holds the local hours (profiles.timezone) whose
-- posts got the most views (median), and `schedule_pick_time` tries those hours instead of the default slots of
-- schedule-defaults.json. Only the candidate times change: the lead time, the gap, the daily cap and the
-- short-vs-its-long-video rule are checked exactly as before, and a time the founder picked on a card is never
-- replaced (moving a slot does not call the picker).

begin;

-- Posts this recent and old enough to have their numbers count; ten of them on a platform before the defaults step
-- aside, and two at an hour before that hour is trusted.
create or replace function public.best_time_rules() returns jsonb
language sql immutable set search_path = public
as $$ select '{"minPosts": 10, "minPostsPerHour": 2, "windowDays": 90, "settleHours": 24}'::jsonb $$;
revoke all on function public.best_time_rules() from public, anon, authenticated;

-- One row per published post with numbers: its platform, local posting hour and newest view count (impressions when
-- the platform reports no views). The posting time is the post's own, else the slot that published it.
create or replace function public.best_time_posts(p_user uuid)
returns table (item_id uuid, platform text, hour smallint, views bigint)
language sql stable security definer set search_path = public
as $$
  with r as (select public.best_time_rules() as j),
  latest as (
    select distinct on (m.item_id) m.item_id, greatest(m.views, coalesce(m.impressions, 0)) as views
    from public.post_metrics m
    where m.user_id = p_user
    order by m.item_id, m.measured_at desc
  ),
  posts as (
    select i.id, public.platform_profile_id(i.platform) as platform, l.views,
      coalesce(i.published_at, (
        select max(s.publish_at) from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
        where s.user_id = p_user and s.status = 'published'
          and ((d.ref_kind = 'content_item' and d.ref_id = i.id)
            or (d.ref_kind = 'clip' and d.ref_id = i.clip_id and s.platform = public.platform_profile_id(i.platform)))
      )) as published_at
    from latest l join public.content_items i on i.id = l.item_id and i.user_id = p_user
  )
  select p.id, p.platform, extract(hour from p.published_at at time zone public.schedule_timezone(p_user))::smallint, p.views
  from posts p, r
  where p.published_at is not null
    and p.platform in ('x', 'threads', 'linkedin', 'tiktok', 'youtube', 'instagram')
    and p.published_at >= now() - make_interval(days => (r.j->>'windowDays')::integer)
    and p.published_at <= now() - make_interval(hours => (r.j->>'settleHours')::integer)
$$;
revoke all on function public.best_time_posts(uuid) from public, anon, authenticated;

-- Recomputes a founder's best hours (service role; pull_metrics calls it after saving numbers). A platform below the
-- minimum loses its rows, so the defaults apply again. Returns how many hours are stored.
create or replace function public.best_slots_refresh(p_user uuid)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  v_rules jsonb := public.best_time_rules();
  v_n integer;
begin
  delete from public.best_slots where user_id = p_user;
  insert into public.best_slots (user_id, platform, hour, median_views_per_hour, posts, computed_at)
  select p_user, b.platform, b.hour, percentile_cont(0.5) within group (order by b.views), count(*), now()
  from public.best_time_posts(p_user) b
  where b.platform in (
    select platform from public.best_time_posts(p_user) group by platform having count(*) >= (v_rules->>'minPosts')::integer)
  group by b.platform, b.hour
  having count(*) >= (v_rules->>'minPostsPerHour')::integer;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.best_slots_refresh(uuid) from public, anon, authenticated;
grant execute on function public.best_slots_refresh(uuid) to service_role;

-- The candidate local times for a platform: the founder's best hours, best first, as many as the defaults offer;
-- the defaults when there are none.
create or replace function public.schedule_candidate_times(p_user uuid, p_platform text)
returns text[] language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select array_agg(to_char(make_time(b.hour, 0, 0), 'HH24:MI') order by b.median_views_per_hour desc, b.hour)
     from (select * from public.best_slots where user_id = p_user and platform = p_platform
           order by median_views_per_hour desc, hour
           limit greatest(1, jsonb_array_length(public.schedule_rules()->'platforms'->p_platform->'times'))) b),
    (select array_agg(t) from jsonb_array_elements_text(public.schedule_rules()->'platforms'->p_platform->'times') t)
  )
$$;
revoke all on function public.schedule_candidate_times(uuid, text) from public, anon, authenticated;

-- As in 20261230100000, with the candidate times above instead of the default slots.
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

commit;
