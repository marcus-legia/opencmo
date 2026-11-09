begin;

-- C2 (owner, 2026-11-09): the founder's own finished edit goes out. A `post_video` order follows it: rendered at its
-- finished hash, looked at, then the `finished_video` card (whose captions Writer writes); approving it makes the
-- `video` deliverable that Schedule proposes times for.

-- A render of the finished edit settled: the look check, then card 3; a failed render fails the order.
create or replace function public.post_video_render_settled(p_order public.work_orders, p_task public.tasks) returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if p_order.status <> 'running' or p_task.settings_hash is distinct from p_order.brief->>'finished_hash' then
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
revoke all on function public.post_video_render_settled(public.work_orders, public.tasks) from public, anon, authenticated;

-- Whether "Mark finished" on this edit should render it for posting (checked before the render, which costs an export):
-- the founder's own finished edit, not a short, a built video (the old long take) or a Studio slideshow or post image,
-- which have their own orders and cards.
create or replace function public.post_video_wanted(p_clip_id uuid) returns boolean
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_clip public.clips;
begin
  v_clip := public.owned_clip(p_clip_id, v_user);
  return v_clip.kind <> 'short'
    and exists (select 1 from public.editor_projects p where p.clip_id = p_clip_id and p.finished_hash is not null
                and p.finished_hash = public.editor_document_hash(p.document))
    and not exists (select 1 from public.studio_steps s left join public.work_orders o on o.id = s.order_id
                    where s.clip_id = p_clip_id
                      and (s.kind in ('slideshow', 'post_image')
                           or (o.kind = 'build_video' and o.status not in ('done', 'failed', 'cancelled'))));
end;
$$;
revoke all on function public.post_video_wanted(uuid) from public, anon;
grant execute on function public.post_video_wanted(uuid) to authenticated;

-- "Mark finished" on the founder's own edit, once its render is queued (the route starts it with the founder's
-- export rights): one open order per edit, following the newest finished hash.
create or replace function public.post_video_start(p_clip_id uuid, p_task uuid) returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
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
    and settings_hash = v_project.finished_hash;
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
revoke all on function public.post_video_start(uuid, uuid) from public, anon;
grant execute on function public.post_video_start(uuid, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.work_order_department(p_kind text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select case p_kind
    when 'post_draft' then 'writer' when 'sales_scan' then 'sales'
    when 'competitor_research' then 'research' when 'pull_metrics' then 'research' when 'review_week' then 'research'
    when 'build_video' then 'studio' when 'cut_shorts' then 'studio' when 'build_slideshow' then 'studio' when 'build_post_image' then 'studio' when 'post_video' then 'studio'
    when 'niche_video_research' then 'research'
    when 'publish_post' then 'publish' when 'write_caption' then 'writer' when 'write_video_brief' then 'writer' when 'write_slides' then 'writer'
    else 'brain' end
$$;

CREATE OR REPLACE FUNCTION public.tasks_studio_rules() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_short public.shorts;
  v_order uuid;
  v_user uuid;
  v_step uuid;
  v_kind text;
  v_post public.work_orders;
begin
  if new.kind not in ('render_document', 'render_stills') or new.status not in ('done', 'failed', 'cancelled') or old.status = new.status
     or new.clip_id is null then
    return new;
  end if;
  -- A slideshow step waiting on its two renders (P5 S3): its card is raised once both are done. A post image step
  -- (P5 S3, B4) waits on its still only and needs no card: its post's card shows it.
  select s.id, s.kind into v_step, v_kind from public.studio_steps s
  where s.kind in ('slideshow', 'post_image') and s.status = 'running' and s.clip_id = new.clip_id
    and (s.input->>'mp4_task' = new.id::text or s.input->>'stills_task' = new.id::text);
  if v_step is not null then
    begin
      if v_kind = 'post_image' then
        perform public.studio_post_image_settle(v_step);
      else
        perform public.studio_slideshow_settle(v_step);
      end if;
    exception when others then
      raise warning 'slideshow render rule failed for task %: %', new.id, sqlerrm;
    end;
    return new;
  end if;
  -- A cancelled render settles a slideshow or post image step (above); shorts and long videos keep their rules.
  if new.kind <> 'render_document' or new.status = 'cancelled' then
    return new;
  end if;
  begin
    select * into v_short from public.shorts where short_clip_id = new.clip_id;
    if found then
      if v_short.status = 'rendering' then
        update public.shorts set status = case new.status when 'done' then 'ready' else 'failed' end where id = v_short.id;
      end if;
      perform public.short_batch_settle(v_short.batch_id);
      return new;
    end if;

    -- A long video an order is making, once the order has reached its render (a step whose next is the render):
    -- the founder's own exports of the edit before that neither raise card 3 nor fail the order.
    select s.order_id, s.user_id into v_order, v_user from public.studio_steps s
    join public.work_orders o on o.id = s.order_id
    where s.clip_id = new.clip_id and o.kind = 'build_video' and o.status not in ('done', 'failed', 'cancelled')
      and s.next->>'tool' = 'render'
    order by s.created_at desc limit 1;
    if v_order is null then
      -- The founder's own finished edit (C2): its `post_video` order, when this is the render of its finished hash.
      for v_post in
        select * from public.work_orders where kind = 'post_video' and status = 'running'
          and user_id = new.user_id and brief->>'clip_id' = new.clip_id::text
      loop
        perform public.post_video_render_settled(v_post, new);
      end loop;
      return new;
    end if;
    if new.status = 'done' then
      if new.settings_hash = (select public.editor_document_hash(document) from public.editor_projects where clip_id = new.clip_id) then
        -- P6 S4: the look check reads the full-size export first; it raises card 3 when it is done.
        if not public.look_check_begin(v_user, 'editor_project', new.clip_id, v_order, new.settings_hash,
            jsonb_build_array(jsonb_build_object('path', new.output_path, 'clip_id', new.clip_id))) then
          perform public.approval_raise(v_user, 'editor_project', new.clip_id);
          perform public.work_order_wait_founder(v_order, 'Your video is rendered');
        end if;
      end if;
    else
      perform public.work_order_move(v_order, 'failed', null, jsonb_build_object('code', 'render_failed',
        'message', left(coalesce(nullif(new.error, ''), 'The render failed.'), 200), 'retryable', true));
    end if;
  exception when others then
    raise warning 'studio render rule failed for task %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.mark_finished(p_clip_id uuid, p_document_hash text) RETURNS public.editor_projects
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := public.require_user();
  v_row public.editor_projects;
  v_order uuid;
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
    insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
    values (v_user, v_order, 'video', 'clip', p_clip_id, 'decided')
    on conflict (ref_kind, ref_id) do nothing;
    perform public.work_order_move(v_order, 'done', 'Approved “' || coalesce(nullif((select hook from public.clips where id = p_clip_id), ''), 'your video') || '”');
  end loop;
  return v_row;
end;
$$;

CREATE OR REPLACE FUNCTION public.approval_decide(p_id uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS public.approvals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_user uuid := public.require_user();
  v_row public.approvals;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_via text := coalesce(nullif(v_payload->>'via', ''), 'app');
  v_target integer;
  v_step public.studio_steps;
  v_batch public.short_batches;
  v_order uuid;
  v_n integer;
  v_text text;
  v_reason text := left(nullif(trim(coalesce(v_payload->>'reason', '')), ''), 400);
  v_caption public.content_items;
  v_title text;
  v_slot public.schedule_slots;
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'The decision is malformed.' using errcode = '22023';
  end if;
  if v_via not in ('app', 'mcp') then
    raise exception 'Cards are decided in the app or through MCP.' using errcode = '22023';
  end if;
  select * into v_row from public.approvals where id = p_id and user_id = v_user for update;
  if not found then
    raise exception 'Card not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'waiting' then
    raise exception 'This card was already decided.' using errcode = 'P0001';
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'This card expired. A new one will ask again.' using errcode = 'P0001';
  end if;
  if v_payload->>'content_hash' is distinct from v_row.content_hash
     or public.approval_hash(public.approval_snapshot(v_row.ref_kind, v_row.ref_id)) is distinct from v_row.content_hash then
    raise exception 'This card changed. Look at it again before deciding.' using errcode = 'P0001';
  end if;

  -- Words on a finished video or a shorts batch: one caption changes, nothing is decided.
  if p_action = 'edit_caption' then
    if v_row.kind not in ('finished_video', 'shorts_batch', 'slideshow') then
      raise exception 'Only a video''s, a batch''s or a slideshow''s captions are edited here.' using errcode = '22023';
    end if;
    if coalesce(v_payload->>'caption', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Say which caption to change.' using errcode = '22023';
    end if;
    select * into v_caption from public.content_items
    where id = (v_payload->>'caption')::uuid and user_id = v_user and department = 'video' and clip_id is not null
      and v_row.snapshot->'captions' @> jsonb_build_array(jsonb_build_object('caption_id', (v_payload->>'caption')))
    for update;
    if not found then
      raise exception 'That caption is not on this card.' using errcode = '22023';
    end if;
    v_text := trim(coalesce(v_payload->>'text', ''));
    v_title := case when v_caption.platform = 'youtube' then nullif(trim(coalesce(v_payload->>'title', v_caption.body->>'title', '')), '') end;
    perform public.caption_check(v_caption.platform, v_text, v_title);
    update public.content_items
    set body = jsonb_strip_nulls(body || jsonb_build_object('text', v_text, 'title', v_title, 'edited_at', now())),
        updated_at = now()
    where id = v_caption.id;
    perform public.approval_refresh(v_row.ref_kind, v_row.ref_id);
    select * into v_row from public.approvals where id = p_id;
    return v_row;
  end if;

  perform set_config('opencmo.decided_via', v_via, true);
  -- The week plan card (cmo-review B2.1) has its own function: it drops items and closes, nothing else runs.
  if v_row.kind = 'plan' then
    perform public.plan_card_decide(v_row, p_action, v_payload);
    perform set_config('opencmo.decided_via', '', true);
    select * into v_row from public.approvals where id = p_id;
    if v_reason is not null and v_row.status = 'skipped' then
      update public.approvals set reason = v_reason where id = p_id returning * into v_row;
    end if;
    return v_row;
  end if;
  case v_row.kind
    when 'post' then
      if p_action not in ('approve', 'skip') then
        raise exception 'Choose approve or skip.' using errcode = '22023';
      end if;
      perform public.cmo_decide_post(v_row.ref_id, p_action, v_payload->>'text', v_payload->>'reason');
    when 'reply' then
      if p_action not in ('replied', 'dismissed') then
        raise exception 'Choose replied or dismissed.' using errcode = '22023';
      end if;
      perform public.cmo_decide_opportunity(v_row.ref_id, p_action, v_payload->>'reason', v_payload->>'text');
    when 'goal' then
      if p_action not in ('approve', 'reject') then
        raise exception 'Choose approve or reject.' using errcode = '22023';
      end if;
      if v_payload ? 'target' then
        if jsonb_typeof(v_payload->'target') <> 'number'
           or (v_payload->>'target')::numeric <> trunc((v_payload->>'target')::numeric) then
          raise exception 'The target must be a whole number.' using errcode = '22023';
        end if;
        v_target := (v_payload->>'target')::numeric::integer;
      end if;
      perform public.cmo_decide_goal(v_row.ref_id, p_action, v_payload->>'goal', v_target);
    when 'correction' then
      perform public.cmo_decide_correction(v_row.ref_id, p_action, v_payload->>'text');
    when 'script', 'price' then
      if v_row.ref_kind = 'work_order' then
        if p_action not in ('approve', 'edit', 'cancel') then
          raise exception 'Choose approve, edit a beat or cancel.' using errcode = '22023';
        end if;
        if p_action = 'edit' then
          select b.beat, b.words into v_n, v_text from public.approval_script_beat(v_row.snapshot->'beats', v_payload) b;
          -- The founder's words are the script they record: kept on the order, the card closes as edited.
          update public.work_orders set brief = jsonb_set(brief, array['storyboard', v_n::text, 'say'], to_jsonb(v_text)),
            updated_at = now()
          where id = v_row.ref_id and user_id = v_user;
          perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'edited');
        else
          perform public.approval_close(v_row.ref_kind, v_row.ref_id, case p_action when 'cancel' then 'skipped' else 'approved' end);
        end if;
        -- The calendar item: approved, the founder records it; cancelled, it is skipped.
        update public.content_items c set status = case p_action when 'cancel' then 'skipped' else 'approved' end,
          decided_at = now(), updated_at = now()
        from public.work_orders o
        where o.id = v_row.ref_id and c.id = o.item_id and c.user_id = v_user and c.status in ('planned', 'drafting', 'in_review');
      else
      if (v_row.kind = 'script' and p_action not in ('approve', 'edit', 'cancel'))
         or (v_row.kind = 'price' and p_action not in ('approve', 'redo', 'cancel')) then
        raise exception '%', case v_row.kind when 'script' then 'Choose approve, edit a beat or cancel.'
          else 'Choose approve, redo a keyframe or cancel.' end using errcode = '22023';
      end if;
      select * into v_step from public.studio_steps where id = v_row.ref_id and user_id = v_user and kind in ('script', 'price') for update;
      if not found or v_step.status <> 'waiting' then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'edit' then
        select b.beat, b.words into v_n, v_text from public.approval_script_beat(v_row.snapshot->'beats', v_payload) b;
        -- The order runner plans the storyboard again with these words (`next`, added in 20261228120000): queued
        -- like any other Studio step, so it waits while the founder's CMO is paused and is retried.
        update public.studio_steps set status = 'cancelled', decision = 'edit', decided_at = now(),
          decision_payload = jsonb_build_object('beat', v_n, 'text', v_text),
          next = '{"tool": "replan"}'::jsonb, next_done_at = null
        where id = v_step.id;
      elsif p_action = 'redo' then
        if jsonb_typeof(v_payload->'index') is distinct from 'number'
           or (v_payload->>'index')::numeric <> trunc((v_payload->>'index')::numeric) then
          raise exception 'Say which keyframe to make again.' using errcode = '22023';
        end if;
        v_n := (v_payload->>'index')::numeric::integer;
        if not exists (select 1 from jsonb_array_elements(v_row.snapshot->'keyframes') k
                       where jsonb_typeof(k->'index') = 'number' and (k->>'index')::numeric = v_n) then
          raise exception 'That keyframe is not on the sheet.' using errcode = '22023';
        end if;
        update public.studio_steps set status = 'approved', decision = 'redo', decided_at = now(),
          decision_payload = jsonb_build_object('index', v_n)
        where id = v_step.id;
      elsif p_action = 'cancel' then
        update public.studio_steps set status = 'cancelled', decision = 'cancel', decided_at = now() where id = v_step.id;
        if v_step.order_id is not null and exists (select 1 from public.work_orders
            where id = v_step.order_id and status not in ('done', 'failed', 'cancelled')) then
          perform public.work_order_move(v_step.order_id, 'cancelled', 'You cancelled the video');
        end if;
      else
        update public.studio_steps set status = 'approved', decision = 'approve', decided_at = now() where id = v_step.id;
      end if;
      end if;
    when 'finished_video' then
      if p_action not in ('approve', 'send_back') then
        raise exception 'Choose approve or send back.' using errcode = '22023';
      end if;
      if p_action = 'approve' then
        -- Closes the card and finishes a video order making this edit (mark_finished owns both).
        perform public.mark_finished(v_row.ref_id, v_row.snapshot->>'document_hash');
      else
        perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'skipped');
        -- A failure is data: the order fails with the founder's reason and the progress check replans it.
        select s.order_id into v_order from public.studio_steps s join public.work_orders o on o.id = s.order_id
        where s.clip_id = v_row.ref_id and o.kind = 'build_video' and o.status not in ('done', 'failed', 'cancelled')
        order by s.created_at desc limit 1;
        if v_order is not null then
          perform public.work_order_move(v_order, 'failed', null, jsonb_build_object('code', 'sent_back',
            'message', coalesce(v_reason, 'The founder sent the video back.'), 'retryable', true,
            'repair_hint', 'Change what the founder asked, then render the video again.'));
        end if;
        -- The founder's own video: they change it in the editor and mark it finished again (a new order).
        for v_order in
          select id from public.work_orders where user_id = v_user and kind = 'post_video'
            and brief->>'clip_id' = v_row.ref_id::text and status not in ('done', 'failed', 'cancelled')
        loop
          perform public.work_order_move(v_order, 'cancelled', 'You sent the video back');
        end loop;
      end if;
    when 'shorts_batch' then
      if p_action not in ('approve', 'send_back') then
        raise exception 'Choose approve or send back.' using errcode = '22023';
      end if;
      select * into v_batch from public.short_batches where id = v_row.ref_id and user_id = v_user for update;
      if not found or v_batch.status <> 'waiting_founder' then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'approve' then
        update public.short_batches set status = 'approved', decided_at = now() where id = v_batch.id;
        update public.shorts set status = 'approved' where batch_id = v_batch.id and status = 'ready';
        -- Each short is its own deliverable, ready for Schedule (P4).
        if v_batch.order_id is not null then
          insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
          select v_user, v_batch.order_id, 'short', 'clip', s.short_clip_id, 'ready'
          from public.shorts s where s.batch_id = v_batch.id and s.status = 'approved' and s.short_clip_id is not null
          on conflict (ref_kind, ref_id) do nothing;
          if exists (select 1 from public.work_orders where id = v_batch.order_id and status not in ('done', 'failed', 'cancelled')) then
            perform public.work_order_move(v_batch.order_id, 'done', 'Shorts approved');
          end if;
        end if;
        perform public.approval_close('short_batch', v_batch.id, 'approved');
      else
        update public.short_batches set status = 'sent_back', decided_at = now() where id = v_batch.id;
        update public.shorts set status = 'sent_back' where batch_id = v_batch.id and status = 'ready';
        -- A failure is data: the replan reads the reason and may not cut the same shorts again (brain.md §6).
        if v_batch.order_id is not null and exists (select 1 from public.work_orders
            where id = v_batch.order_id and status not in ('done', 'failed', 'cancelled')) then
          perform public.work_order_move(v_batch.order_id, 'failed', null, jsonb_build_object('code', 'sent_back',
            'message', coalesce(v_reason, 'The founder sent the shorts back.'), 'retryable', true,
            'repair_hint', 'Cut different ranges from the same finished edit.'));
        end if;
        perform public.approval_close('short_batch', v_batch.id, 'skipped');
      end if;
    when 'slideshow' then
      -- Rendered before the card was raised, so approving runs nothing: the step and its order finish here and the
      -- MP4 becomes the slideshow deliverable Schedule picks up (A3). Text edits happen in the Slides view, which
      -- changes the document and raises a new card.
      if p_action not in ('approve', 'send_back') then
        raise exception 'Choose approve or send back.' using errcode = '22023';
      end if;
      select * into v_step from public.studio_steps where id = v_row.ref_id and user_id = v_user and kind = 'slideshow' for update;
      if not found or v_step.status <> 'waiting' then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'approve' then
        update public.studio_steps set status = 'done', decision = 'approve', decided_at = now() where id = v_step.id;
        if v_step.order_id is not null then
          insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
          values (v_user, v_step.order_id, 'slideshow', 'clip', v_step.clip_id, 'ready')
          on conflict (ref_kind, ref_id) do nothing;
          if exists (select 1 from public.work_orders where id = v_step.order_id and status not in ('done', 'failed', 'cancelled')) then
            perform public.work_order_move(v_step.order_id, 'done', 'Slideshow approved');
          end if;
        end if;
      else
        update public.studio_steps set status = 'cancelled', decision = 'cancel', decided_at = now() where id = v_step.id;
        -- A failure is data: the order fails with the founder's reason and the progress check replans it.
        if v_step.order_id is not null and exists (select 1 from public.work_orders
            where id = v_step.order_id and status not in ('done', 'failed', 'cancelled')) then
          perform public.work_order_move(v_step.order_id, 'failed', null, jsonb_build_object('code', 'sent_back',
            'message', coalesce(v_reason, 'The founder sent the slideshow back.'), 'retryable', true,
            'repair_hint', 'Change what the founder asked, then build the slideshow again.'));
        end if;
      end if;
    when 'schedule' then
      -- Time, account and platform fields change through schedule_change, which raises the card again; the
      -- answer is the new card, so the founder looks at what they now approve.
      if p_action in ('change_time', 'change_account', 'set_options') then
        perform set_config('opencmo.decided_via', '', true);
        return public.schedule_change(v_row.ref_id, p_action, v_payload);
      end if;
      if p_action not in ('approve', 'retry', 'cancel') then
        raise exception 'Choose approve, change the time or account, or cancel.' using errcode = '22023';
      end if;
      select * into v_slot from public.schedule_slots where id = v_row.ref_id and user_id = v_user for update;
      if not found or v_slot.status not in ('proposed', 'failed') then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'cancel' then
        update public.schedule_slots set status = 'cancelled', updated_at = now() where id = v_slot.id;
        perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'skipped');
      elsif v_slot.status = 'failed' and now() >= v_slot.window_ends_at then
        -- Too late for this time: never post late. The founder's Retry asks for a new time instead.
        perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'approved');
        perform public.schedule_propose(v_slot.deliverable_id);
      else
        if p_action = 'retry' and v_slot.status <> 'failed' then
          raise exception 'There is nothing to retry.' using errcode = '22023';
        end if;
        perform public.schedule_ready_check(v_slot);
        begin
          update public.schedule_slots set status = 'waiting', updated_at = now() where id = v_slot.id;
        exception when unique_violation then
          raise exception 'This post already has another time on %.', public.schedule_platform_label(v_slot.platform)
            using errcode = 'P0001';
        end;
        perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'approved');
      end if;
    else
      raise exception 'This card cannot be decided yet.' using errcode = 'P0001';
  end case;
  perform set_config('opencmo.decided_via', '', true);

  select * into v_row from public.approvals where id = p_id;
  if v_reason is not null and v_row.status in ('skipped', 'edited') then
    update public.approvals set reason = v_reason where id = p_id returning * into v_row;
  end if;
  return v_row;
end;
$_$;

CREATE OR REPLACE FUNCTION public.schedule_propose(p_deliverable uuid) RETURNS integer
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
begin
  select * into v_d from public.deliverables where id = p_deliverable;
  if not found then
    return 0;
  end if;
  if v_d.kind = 'post' and v_d.ref_kind = 'content_item' then
    -- Writer stores the calendar's label ("X", "Threads", "LinkedIn"); slots use the platform's id.
    select array_agg(public.platform_profile_id(platform)) into v_platforms from public.content_items
    where id = v_d.ref_id and status = 'approved' and public.platform_profile_id(platform) in ('x', 'threads', 'linkedin');
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
    v_at := public.schedule_pick_time(v_d.user_id, v_platform, v_d.id);
    continue when v_at is null;
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
    perform public.approval_raise(v_d.user_id, 'schedule_slot', v_slot);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

CREATE OR REPLACE FUNCTION public.schedule_follow_deliverable() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if (new.kind = 'post' and new.status = 'decided' and (tg_op = 'INSERT' or old.status is distinct from 'decided'))
     or (new.kind in ('short', 'slideshow', 'video') and tg_op = 'INSERT') then
    begin
      perform public.schedule_propose(new.id);
    exception when others then
      -- Scheduling is never a reason to undo the founder's approval of the work itself.
      raise warning 'schedule rule for deliverable % failed: %', new.id, sqlerrm;
    end;
  end if;
  -- A post's image arrived (P5 B4): the post's schedule cards change. One still waiting is refreshed; one already
  -- approved goes back to the founder, so nothing posts with an image they did not see.
  if new.kind = 'image' and tg_op = 'INSERT' and new.post_id is not null then
    begin
      perform public.schedule_image_changed(new.post_id);
    exception when others then
      raise warning 'image rule for deliverable % failed: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.schedule_follow_content() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deliverable uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  begin
    if new.status = 'approved' and new.department = 'video' and new.clip_id is not null then
      select id into v_deliverable from public.deliverables
      where ref_kind = 'clip' and ref_id = new.clip_id and kind in ('short', 'slideshow', 'video') and user_id = new.user_id;
      if v_deliverable is not null then
        perform public.schedule_propose(v_deliverable);
      end if;
    elsif new.status = 'published' and new.department = 'post' then
      -- Posted by hand (copy and open, or marked posted): what still waits for its time is dropped with its card.
      update public.approvals a set status = 'cancelled', decided_at = now()
      from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id
      where a.ref_kind = 'schedule_slot' and a.ref_id = s.id and a.status = 'waiting'
        and d.ref_kind = 'content_item' and d.ref_id = new.id and s.status in ('proposed', 'waiting');
      update public.schedule_slots s set status = 'cancelled', updated_at = now()
      from public.deliverables d
      where d.id = s.deliverable_id and d.ref_kind = 'content_item' and d.ref_id = new.id
        and s.status in ('proposed', 'waiting');
    end if;
  exception when others then
    raise warning 'schedule rule for content item % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

commit;
