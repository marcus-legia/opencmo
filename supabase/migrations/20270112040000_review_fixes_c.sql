-- Code review of C2 and C3 (2026-11-09):
-- * an edited video posted before: its deliverable moves to the new order and is proposed again (the card could
--   never be approved: the order had no new deliverable and no reason to be done);
-- * marking it finished again at a hash already rendering, waiting or approved starts no second order and card;
-- * a render finishing while `post_video_start` runs is settled after it commits (the task row is held);
-- * a render of an edit changed since it was marked finished raises no card, and the change cancels its order;
-- * a post image's title fits one slide heading (60), cut at a word.

begin;

CREATE OR REPLACE FUNCTION public.mark_finished(p_clip_id uuid, p_document_hash text) RETURNS public.editor_projects
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_row public.editor_projects;
  v_order uuid;
  v_deliverable uuid;
  v_again boolean;
begin
  perform public.owned_clip(p_clip_id, v_user);
  select * into v_row from public.editor_projects where clip_id = p_clip_id for update;
  if not found then
    raise exception 'This edit has nothing to finish yet.' using errcode = 'P0002';
  end if;
  if p_document_hash is null or p_document_hash is distinct from public.editor_document_hash(v_row.document) then
    raise exception 'This edit changed. Look at it again before marking it finished.' using errcode = 'P0001';
  end if;
  if v_row.finished_hash is distinct from p_document_hash then
    update public.editor_projects set finished_at = now(), finished_hash = p_document_hash
    where clip_id = p_clip_id
    returning * into v_row;
  end if;
  -- Marking it finished in the editor or Studio is the same decision as approving card 3, in either order: the card
  -- closes, and a video order making this edit is done with the edit as its deliverable.
  perform public.approval_close('editor_project', p_clip_id, 'approved');
  -- Only a built video finishes its order (the order reached its render); before that a waiting card 2 still runs.
  select s.order_id into v_order from public.studio_steps s join public.work_orders o on o.id = s.order_id
  where s.clip_id = p_clip_id and o.kind = 'build_video' and o.status not in ('done', 'failed', 'cancelled')
    and s.next->>'tool' = 'render'
  order by s.created_at desc limit 1;
  if v_order is not null then
    insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
    values (v_user, v_order, 'video', 'clip', p_clip_id, 'decided')
    on conflict (ref_kind, ref_id) do nothing;
    perform public.work_order_move(v_order, 'done', 'Finished “' || coalesce(nullif((select hook from public.clips where id = p_clip_id), ''), 'the video') || '”');
  end if;
  -- The founder's own video (C2): approving its rendered card (or marking it finished again while the card waits) is
  -- the decision; the edit becomes the order's `video` deliverable, which Schedule proposes times for.
  for v_order in
    select id from public.work_orders where user_id = v_user and kind = 'post_video' and status = 'waiting_founder'
      and brief->>'clip_id' = p_clip_id::text and brief->>'finished_hash' = p_document_hash
  loop
    -- A video posted before and edited since has its deliverable already: it now belongs to this order, and Schedule
    -- proposes again where nothing waits or went out.
    insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
    values (v_user, v_order, 'video', 'clip', p_clip_id, 'decided')
    on conflict (ref_kind, ref_id) do update set order_id = excluded.order_id, status = 'decided'
    returning id, (xmax <> 0) into v_deliverable, v_again;
    if v_again then
      perform public.schedule_propose(v_deliverable);
    end if;
    perform public.work_order_move(v_order, 'done', 'Approved “' || coalesce(nullif((select hook from public.clips where id = p_clip_id), ''), 'your video') || '”',
      null, 'The founder approved the video.');
  end loop;
  return v_row;
end;
$$;

CREATE OR REPLACE FUNCTION public.post_video_wanted(p_clip_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_clip public.clips;
begin
  v_clip := public.owned_clip(p_clip_id, v_user);
  return v_clip.kind <> 'short'
    and exists (select 1 from public.editor_projects p where p.clip_id = p_clip_id and p.finished_hash is not null
                and p.finished_hash = public.editor_document_hash(p.document))
    -- Already rendering, waiting on its card, or approved at this hash: marking it finished again starts nothing.
    and not exists (select 1 from public.work_orders o join public.editor_projects p on p.clip_id = p_clip_id
                    where o.user_id = v_user and o.kind = 'post_video' and o.brief->>'clip_id' = p_clip_id::text
                      and o.brief->>'finished_hash' = p.finished_hash and o.status in ('running', 'waiting_founder', 'done'))
    and not exists (select 1 from public.studio_steps s left join public.work_orders o on o.id = s.order_id
                    where s.clip_id = p_clip_id
                      and (s.kind in ('slideshow', 'post_image')
                           or (o.kind = 'build_video' and o.status not in ('done', 'failed', 'cancelled'))));
end;
$$;

CREATE OR REPLACE FUNCTION public.post_video_start(p_clip_id uuid, p_task uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_clip public.clips;
  v_project public.editor_projects;
  v_task public.tasks;
  v_root public.work_orders;
  v_order public.work_orders;
begin
  v_clip := public.owned_clip(p_clip_id, v_user);
  if v_clip.kind = 'short' then
    raise exception 'A short goes out with its batch.' using errcode = 'P0001';
  end if;
  select * into v_project from public.editor_projects where clip_id = p_clip_id for update;
  if not found or v_project.finished_hash is null
     or v_project.finished_hash is distinct from public.editor_document_hash(v_project.document) then
    raise exception 'Mark the edit finished first.' using errcode = 'P0001';
  end if;
  select * into v_task from public.tasks
  where id = p_task and user_id = v_user and clip_id = p_clip_id and kind = 'render_document'
    and settings_hash = v_project.finished_hash
  -- Held until this order commits: a render finishing meanwhile settles after, when the task rule can see the order.
  for update;
  if not found then
    raise exception 'That render is not of this edit.' using errcode = 'P0001';
  end if;
  if not public.post_video_wanted(p_clip_id) then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('post_video:' || p_clip_id::text, 0));
  select * into v_order from public.work_orders
  where user_id = v_user and kind = 'post_video' and brief->>'clip_id' = p_clip_id::text
    and status not in ('done', 'failed', 'cancelled')
  order by created_at desc limit 1 for update;
  if found then
    if v_order.brief->>'finished_hash' is distinct from v_project.finished_hash then
      update public.work_orders set brief = brief || jsonb_build_object('finished_hash', v_project.finished_hash), updated_at = now()
      where id = v_order.id returning * into v_order;
    end if;
    if v_order.status <> 'running' then
      v_order := public.work_order_move(v_order.id, 'running', 'Rendering your video');
    end if;
  else
    v_root := public.work_order_week_root(v_user);
    v_order := public.work_order_create(v_user, v_root.week, v_root.id, 'post_video',
      left('Post “' || coalesce(nullif(v_clip.hook, ''), 'your video') || '”', 200),
      jsonb_build_object('clip_id', p_clip_id, 'finished_hash', v_project.finished_hash,
        'done_when', 'The founder approved the finished video.'),
      0, null, '{}', 'founder');
    v_order := public.work_order_move(v_order.id, 'running', 'Rendering your video');
  end if;
  -- The render may be done already (the same edit rendered before): settle it now, the task trigger will not fire.
  if v_task.status in ('done', 'failed') then
    perform public.post_video_render_settled(v_order, v_task);
  end if;
  return v_order.id;
end;
$$;

CREATE OR REPLACE FUNCTION public.post_video_render_settled(p_order public.work_orders, p_task public.tasks) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- Only the render of the edit as it is still finished: one changed since is not what the founder marked.
  if p_order.status <> 'running' or p_task.settings_hash is distinct from p_order.brief->>'finished_hash'
     or not exists (select 1 from public.editor_projects p where p.clip_id = p_task.clip_id
                    and p.finished_hash = p_task.settings_hash and p.finished_hash = public.editor_document_hash(p.document)) then
    return;
  end if;
  if p_task.status = 'done' then
    if not public.look_check_begin(p_order.user_id, 'editor_project', p_task.clip_id, p_order.id, p_task.settings_hash,
        jsonb_build_array(jsonb_build_object('path', p_task.output_path, 'clip_id', p_task.clip_id))) then
      perform public.approval_raise(p_order.user_id, 'editor_project', p_task.clip_id);
      perform public.work_order_wait_founder(p_order.id, 'Your video is rendered');
    end if;
  elsif p_task.status = 'failed' then
    perform public.work_order_move(p_order.id, 'failed', null, jsonb_build_object('code', 'render_failed',
      'message', left(coalesce(nullif(p_task.error, ''), 'The render failed.'), 200), 'retryable', true,
      'repair_hint', 'Mark the edit finished again to render it again.'));
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.editor_projects_rules() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid;
  v_order uuid;
begin
  if new.document is distinct from old.document then
    perform public.approval_close('editor_project', new.clip_id, 'cancelled');
    -- The founder's own video changed after they marked it finished: its posting stops; marking it finished again
    -- starts a new one (C2).
    for v_order in
      select id from public.work_orders where kind = 'post_video' and brief->>'clip_id' = new.clip_id::text
        and status in ('running', 'waiting_founder')
    loop
      perform public.work_order_move(v_order, 'cancelled', 'The edit changed after you marked it finished');
    end loop;
  end if;
  if new.finished_hash is not null and new.finished_hash is distinct from old.finished_hash then
    select j.user_id into v_user from public.clips c join public.jobs j on j.id = c.job_id
    where c.id = new.clip_id and c.kind <> 'short';
    if v_user is not null and not public.cmo_paused(v_user) then
      begin
        perform public.cut_shorts_order_for(v_user, new.clip_id, 'event');
      exception when others then
        raise warning 'cut_shorts rule failed for clip %: %', new.clip_id, sqlerrm;
      end;
    end if;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.content_items_post_image() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

commit;
