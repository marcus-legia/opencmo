-- C3 (owner, 2026-11-09): a post the plan marks gets an image. When the founder approves it, the Post image squad
-- builds one (`build_post_image`: the post's title on the Brand Kit, or a frame of their video; nothing is generated),
-- and its schedule card shows it (`schedule_image_changed`).

begin;

alter table public.content_items add column if not exists wants_image boolean not null default false;

CREATE OR REPLACE FUNCTION public.cmo_plan_week(p_user uuid, p_run uuid, p_items jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_day date;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'This plan is not valid.' using errcode = '22023';
  end if;
  delete from public.content_items where user_id = p_user and status = 'planned' and day >= current_date;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_day := (v_item->>'day')::date;
    if v_day < current_date or v_day > current_date + 13 then
      continue;
    end if;
    insert into public.content_items (user_id, run_id, department, platform, day, idea, reason, wants_image)
    values (
      p_user, p_run, v_item->>'department', left(v_item->>'platform', 20), v_day,
      left(v_item->>'idea', 300), left(coalesce(v_item->>'reason', ''), 300),
      coalesce(v_item->>'department' = 'post' and jsonb_typeof(v_item->'image') = 'boolean' and (v_item->>'image')::boolean, false)
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

create or replace function public.content_items_post_image() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_root public.work_orders;
  v_profile text;
begin
  if new.department <> 'post' or not new.wants_image or new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;
  begin
    if public.cmo_paused(new.user_id)
       or exists (select 1 from public.deliverables where post_id = new.id and kind = 'image')
       or exists (select 1 from public.work_orders where user_id = new.user_id and kind = 'build_post_image'
                  and brief->>'postId' = new.id::text and status not in ('failed', 'cancelled')) then
      return new;
    end if;
    v_profile := coalesce(public.platform_profile_id(new.platform), 'x');
    v_root := public.work_order_week_root(new.user_id);
    perform public.work_order_create(new.user_id, v_root.week, v_root.id, 'build_post_image',
      left('Image for “' || new.idea || '”', 200),
      jsonb_build_object('postId', new.id, 'title', left(new.idea, 120), 'platform', v_profile,
        'done_when', 'The post''s schedule card shows the image.'),
      0, null, '{}', 'event');
  exception when others then
    -- An image is never a reason to undo the founder's approval of the post.
    raise warning 'post image rule failed for content item %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.content_items_post_image() from public, anon, authenticated;

drop trigger if exists content_items_post_image on public.content_items;
create trigger content_items_post_image after update of status on public.content_items
  for each row execute function public.content_items_post_image();

commit;
