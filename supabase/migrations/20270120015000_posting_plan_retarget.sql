-- The week plan follows the posting plan (daily core drafts, owner 2026-11-12).
--
-- 1. `cmo_plan_week` keeps each post's targets: the planner writes one core post per slot and the platforms it goes to
--    (`body.targets`, ids from `dayTargets` in apps/web/lib/cmo/posting-plan.ts); `platform` stays the first target's
--    label so readers that know only `platform` keep working. A week at the plan's top (3 posts a day, 3 x 7 video
--    scripts, a Reddit item a day) is 49 items, so the limit moves from 30 to 60.
-- 2. `save_posting_plan` retargets the founder's posts that are still only planned (not drafted) from today on: a
--    post takes the new plan's slot of its rank within its day; past the new number of slots it takes the last slot
--    (platforms that are still on), so nothing the founder wrote into the calendar is deleted. With every count at 0
--    there is no slot to take: the posts stay as they are until the next week plan replaces them.
--
-- Redeclares both functions of 20270120010000 / 20270112030000; their grants are kept by `create or replace`.

-- A post's targets as the planner sent them, or null when they are not a non-empty list of distinct text platforms.
create or replace function public.posting_plan_targets(p_targets jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when jsonb_typeof(p_targets) = 'array'
      and jsonb_array_length(p_targets) between 1 and 3
      and (select bool_and(jsonb_typeof(t) = 'string' and t #>> '{}' in ('x', 'threads', 'linkedin')) from jsonb_array_elements(p_targets) t)
      and (select count(distinct t) from jsonb_array_elements(p_targets) t) = jsonb_array_length(p_targets)
    then p_targets
    else null end
$$;
revoke all on function public.posting_plan_targets(jsonb) from public, anon, authenticated;

create or replace function public.cmo_plan_week(p_user uuid, p_run uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_day date;
  v_targets jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 then
    raise exception 'This plan is not valid.' using errcode = '22023';
  end if;
  delete from public.content_items where user_id = p_user and status = 'planned' and day >= current_date;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_day := (v_item->>'day')::date;
    if v_day < current_date or v_day > current_date + 13 then
      continue;
    end if;
    v_targets := case when v_item->>'department' = 'post' then public.posting_plan_targets(v_item->'targets') end;
    insert into public.content_items (user_id, run_id, department, platform, day, idea, reason, wants_image, body)
    values (
      p_user, p_run, v_item->>'department', left(v_item->>'platform', 20), v_day,
      left(v_item->>'idea', 300), left(coalesce(v_item->>'reason', ''), 300),
      coalesce(v_item->>'department' = 'post' and jsonb_typeof(v_item->'image') = 'boolean' and (v_item->>'image')::boolean, false),
      case when v_targets is null then '{}'::jsonb else jsonb_build_object('targets', v_targets) end
    );
    v_count := v_count + 1;
  end loop;
  -- The tree only tracks the plan: a fault in it must not lose the calendar.
  begin
    perform public.work_orders_plan_week(p_user, p_run);
  exception when others then
    raise warning 'work_orders_plan_week failed for run %: %', p_run, sqlerrm;
  end;
  return v_count;
end;
$$;

create or replace function public.save_posting_plan(p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_key text;
  v_val jsonb;
  v_slots jsonb[];
  v_n integer;
  v_most integer;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object'
     or jsonb_typeof(p_plan->'text') is distinct from 'object' or jsonb_typeof(p_plan->'video') is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_plan)) <> 2 then
    raise exception 'The posting plan needs a text and a video section.' using errcode = '22023';
  end if;

  if (select array_agg(k order by k) from jsonb_object_keys(p_plan->'text') k) is distinct from array['linkedin', 'threads', 'x'] then
    raise exception 'Posts a day are set for X, Threads and LinkedIn.' using errcode = '22023';
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

  update public.profiles set posting_plan = p_plan where id = v_user;
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  -- The day's slots as `dayTargets` builds them: slot i goes to every platform (in X, Threads, LinkedIn order) whose
  -- count is above i.
  v_most := greatest((p_plan->'text'->>'x')::int, (p_plan->'text'->>'threads')::int, (p_plan->'text'->>'linkedin')::int);
  v_slots := array(
    select (select jsonb_agg(p order by o) from unnest(array['x', 'threads', 'linkedin']) with ordinality as u(p, o)
            where (p_plan->'text'->>p)::int > i)
    from generate_series(0, v_most - 1) i order by i);
  v_n := coalesce(array_length(v_slots, 1), 0);
  if v_n > 0 then
    update public.content_items c
    set body = c.body || jsonb_build_object('targets', v_slots[least(r.rank, v_n)]),
        platform = public.platform_profile(v_slots[least(r.rank, v_n)]->>0)->>'label',
        updated_at = now()
    from (
      select id, row_number() over (partition by day order by created_at, id)::int as rank
      from public.content_items
      where user_id = v_user and department = 'post' and status = 'planned' and day >= current_date
    ) r
    where c.id = r.id;
  end if;
  return p_plan;
end;
$$;

revoke all on function public.save_posting_plan(jsonb) from public, anon;
grant execute on function public.save_posting_plan(jsonb) to authenticated;
