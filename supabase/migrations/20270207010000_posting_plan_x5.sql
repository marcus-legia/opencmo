-- X up to 5 posts a day (owner, 2026-11-27; plan docs/superpowers/plans/2026-11-27-content-plan-and-x-news.md, A2).
--
-- `save_posting_plan`: X takes 0 to 5 posts a day, Threads, LinkedIn and Facebook 0 to 3 (`TEXT_MAX` in
-- lib/cmo/posting-plan.ts). `schedule_rules()`: X gets five default times, three hours apart, so each of five posts has
-- one (packages/contracts/schedule-defaults.json holds the same; schedule-defaults.check.ts compares them).
-- `cmo_plan_week`: slots 3 and 4 are kept (it kept 0 to 2 only, so the fourth and fifth post of a day lost their slot
-- and their order), a week can hold 80 items (5 posts x 7 days + 21 videos + 7 Reddit items is 63, over the old 60),
-- and each post keeps its `news` mode (A5).
--
-- Redeclares functions of 20270120030000 and 20270205020000; `create or replace` keeps their grants.

begin;

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
  -- X takes up to 5 posts a day, the others up to 3 (owner, 2026-11-27; posting-plan.ts `TEXT_MAX`).
  for v_key, v_val in select * from jsonb_each(p_plan->'text') loop
    if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
       or (v_val #>> '{}')::numeric not between 0 and (case when v_key = 'x' then 5 else 3 end) then
      raise exception 'X takes 0 to 5 posts a day; the others 0 to 3.' using errcode = '22023';
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

create or replace function public.schedule_rules() RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$ select '{"minGapHours": 3, "windowMinutes": 15, "leadMinutes": 30, "horizonDays": 14, "maxProposals": 3, "jitterSeconds": 240, "platforms": {"x": {"times": ["09:00", "12:00", "15:00", "18:00", "21:00"], "dailyCap": 5}, "threads": {"times": ["09:00", "12:00"], "dailyCap": 2}, "linkedin": {"times": ["16:00"], "dailyCap": 1}, "facebook": {"times": ["09:00", "13:00"], "dailyCap": 2}, "tiktok": {"times": ["09:00", "13:00"], "dailyCap": 2}, "instagram": {"times": ["09:00"], "dailyCap": 1}, "youtube": {"times": ["16:00", "19:00"], "dailyCap": 2}}}'::jsonb $$;

create or replace function public.cmo_plan_week(p_user uuid, p_run uuid, p_items jsonb)
returns integer
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_day date;
  v_targets jsonb;
  v_sources jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 80 then
    raise exception 'This plan is not valid.' using errcode = '22023';
  end if;
  delete from public.content_items where user_id = p_user and status = 'planned' and day >= current_date;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_day := (v_item->>'day')::date;
    if v_day < current_date or v_day > current_date + 13 then
      continue;
    end if;
    v_targets := case when v_item->>'department' = 'post' then public.posting_plan_targets(v_item->'targets') end;
    v_sources := case when v_item->>'department' = 'post' then public.post_sources_clean(p_user, v_item->'sources') end;
    insert into public.content_items (user_id, run_id, department, platform, day, idea, reason, wants_image, body)
    values (
      p_user, p_run, v_item->>'department', left(v_item->>'platform', 20), v_day,
      left(v_item->>'idea', 300), left(coalesce(v_item->>'reason', ''), 300),
      coalesce(v_item->>'department' = 'post' and jsonb_typeof(v_item->'image') = 'boolean' and (v_item->>'image')::boolean, false),
      (case
        when v_targets is null then '{}'::jsonb
        when jsonb_typeof(v_item->'slot') = 'number' and (v_item->>'slot')::numeric in (0, 1, 2, 3, 4)
          then jsonb_build_object('targets', v_targets, 'slot', (v_item->>'slot')::int)
        else jsonb_build_object('targets', v_targets)
      end) || jsonb_strip_nulls(jsonb_build_object(
        'sources', v_sources,
        -- The planner's angle (owner, 2026-11-24): about four posts in five share, one asks to try the product.
        'angle', case when v_item->>'department' = 'post' and v_item->>'angle' in ('share', 'cta') then v_item->>'angle' end,
        -- How the post uses an X News story (owner, 2026-11-27): required, hook or none; anything else is dropped and
        -- the draft reads it as hook.
        'news', case when v_item->>'department' = 'post' and v_item->>'news' in ('required', 'hook', 'none') then v_item->>'news' end,
        -- A post planned with no Library sources from the founder's brief or the first week (onboarding): the draft
        -- writes it without sources instead of refusing it for an empty Library.
        'planned_from', case when v_item->>'department' = 'post' and v_sources is null
                               and v_item->>'planned_from' in ('brief', 'onboarding') then v_item->>'planned_from' end))
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

commit;
