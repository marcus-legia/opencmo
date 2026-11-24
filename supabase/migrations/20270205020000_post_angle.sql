-- The week plan keeps each post's angle (owner, 2026-11-24): `share` (what people asked and what helps) or `cta` (ends
-- with a soft call to try the product), about one in five. `cmo_plan_week` keeps only the body keys it knows, so it
-- dropped `angle` and every post drafted as `share`. Anything but those two words is dropped.

begin;

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
    v_sources := case when v_item->>'department' = 'post' then public.post_sources_clean(p_user, v_item->'sources') end;
    insert into public.content_items (user_id, run_id, department, platform, day, idea, reason, wants_image, body)
    values (
      p_user, p_run, v_item->>'department', left(v_item->>'platform', 20), v_day,
      left(v_item->>'idea', 300), left(coalesce(v_item->>'reason', ''), 300),
      coalesce(v_item->>'department' = 'post' and jsonb_typeof(v_item->'image') = 'boolean' and (v_item->>'image')::boolean, false),
      (case
        when v_targets is null then '{}'::jsonb
        when jsonb_typeof(v_item->'slot') = 'number' and (v_item->>'slot')::numeric in (0, 1, 2)
          then jsonb_build_object('targets', v_targets, 'slot', (v_item->>'slot')::int)
        else jsonb_build_object('targets', v_targets)
      end) || jsonb_strip_nulls(jsonb_build_object(
        'sources', v_sources,
        -- The planner's angle (owner, 2026-11-24): about four posts in five share, one asks to try the product.
        'angle', case when v_item->>'department' = 'post' and v_item->>'angle' in ('share', 'cta') then v_item->>'angle' end,
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
