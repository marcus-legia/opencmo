-- 20261228110000: P2 A3, the finished state and Studio's event rules (plan F6, F8, F9; sessions/A.md A3).
--
-- - Any edit after "Mark finished" clears the mark: a trigger on `editor_projects` compares the saved document's hash
--   with `finished_hash`, so every write path (the editor's save, the Assistant, MCP, the brain) clears it the same way.
-- - Rules (all in SQL, so they hold whoever moved the row):
--   finished edit → a `cut_shorts` order (once per edit and finished hash; not for a short, not while paused);
--   short renders done → the batch card; batch approved → one `short` deliverable per short, ready for Schedule (P4);
--   a render of a video order's edit done → card 3 (finished video), failed → the order fails with the reason;
--   card 3 approved → the edit is the order's `video` deliverable and the order is done.
-- - B's adapter calls `cut_shorts_order` (the founder's "Cut shorts") and `short_batch_create` (the Builder's output).

begin;

-- Studio's orders belong to Studio.
create or replace function public.work_order_department(p_kind text) returns text
language sql immutable set search_path = public
as $$
  select case p_kind
    when 'post_draft' then 'writer' when 'sales_scan' then 'sales'
    when 'competitor_research' then 'research' when 'pull_metrics' then 'research' when 'review_week' then 'research'
    when 'build_video' then 'studio' when 'cut_shorts' then 'studio'
    else 'brain' end
$$;
revoke all on function public.work_order_department(text) from public, anon, authenticated;

-- A video and a short are deliverables that live in `clips`.
alter table public.deliverables drop constraint deliverables_ref_kind_check;
alter table public.deliverables add constraint deliverables_ref_kind_check
  check (ref_kind in ('content_item', 'opportunity', 'insight', 'clip'));

-- The week's root, made the way `work_orders_plan_week` makes it when an order arrives before the plan does (a
-- founder cuts shorts on a Monday morning). The plan later finds it and plans under it.
create or replace function public.work_order_week_root(p_user uuid)
returns public.work_orders language plpgsql volatile security definer set search_path = public
as $$
declare
  v_week date := date_trunc('week', current_date)::date;
  v_root public.work_orders;
  v_goal text;
  v_budget integer;
begin
  select * into v_root from public.work_orders where user_id = p_user and week = v_week and parent_id is null for update;
  if found then
    return v_root;
  end if;
  select goal into v_goal from public.cmo_goals where user_id = p_user and week = v_week and status = 'approved';
  select weekly_credit_budget into v_budget from public.profiles where id = p_user;
  return public.work_order_create(p_user, v_week, null, 'plan_week',
    coalesce('Week of ' || to_char(v_week, 'Mon DD') || ': ' || v_goal, 'Week of ' || to_char(v_week, 'Mon DD')),
    jsonb_build_object('objective', coalesce(v_goal, 'Plan and run this week''s marketing.')),
    coalesce(v_budget, 0), (v_week + 7)::timestamptz);
end;
$$;
revoke all on function public.work_order_week_root(uuid) from public, anon, authenticated;

-- Moves an order to `waiting_founder` from wherever it is (a queued order passes through `running`).
create or replace function public.work_order_wait_founder(p_id uuid, p_text text)
returns void language plpgsql volatile security definer set search_path = public
as $$
declare
  v_status text := (select status from public.work_orders where id = p_id);
begin
  if v_status is null or v_status in ('waiting_founder', 'done', 'failed', 'cancelled') then
    return;
  end if;
  if v_status = 'queued' then
    perform public.work_order_move(p_id, 'running');
  end if;
  perform public.work_order_move(p_id, 'waiting_founder', p_text);
end;
$$;
revoke all on function public.work_order_wait_founder(uuid, text) from public, anon, authenticated;

-- The `cut_shorts` order for a finished edit: once per (edit, finished hash), so a double click or the rule and the
-- button together make one. `p_created_by`: `founder` (the button) or `event` (the rule).
create or replace function public.cut_shorts_order_for(p_user uuid, p_clip_id uuid, p_created_by text)
returns uuid language plpgsql volatile security definer set search_path = public
as $$
declare
  v_clip public.clips := public.owned_clip(p_clip_id, p_user);
  v_project public.editor_projects;
  v_root public.work_orders;
  v_id uuid;
begin
  if v_clip.kind = 'short' then
    raise exception 'A short is not cut into shorts.' using errcode = 'P0001';
  end if;
  select * into v_project from public.editor_projects where clip_id = p_clip_id for update;
  if not found or v_project.finished_hash is null
     or v_project.finished_hash is distinct from public.editor_document_hash(v_project.document) then
    raise exception 'Mark this edit finished first: shorts are cut only from a finished edit.' using errcode = 'P0001';
  end if;
  if public.cmo_paused(p_user) then
    raise exception 'Your CMO is paused. Resume it to start new work.' using errcode = 'P0001';
  end if;
  select id into v_id from public.work_orders
  where user_id = p_user and kind = 'cut_shorts' and brief->>'clip_id' = p_clip_id::text
    and brief->>'finished_hash' = v_project.finished_hash and status not in ('failed', 'cancelled')
  limit 1;
  if found then
    return v_id;
  end if;
  -- Each order runs the Clip editor and renders three shorts: a daily cap keeps re-marking from looping it.
  if (select count(*) from public.work_orders where user_id = p_user and kind = 'cut_shorts'
      and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You can cut shorts 10 times a day. Try again tomorrow.' using errcode = 'P0001';
  end if;
  v_root := public.work_order_week_root(p_user);
  select id into v_id from public.work_order_create(p_user, v_root.week, v_root.id, 'cut_shorts',
    left('Shorts from “' || coalesce(nullif(v_clip.hook, ''), 'your video') || '”', 200),
    jsonb_build_object('objective', 'Cut 3 shorts from the finished edit.', 'clip_id', p_clip_id,
      'finished_hash', v_project.finished_hash, 'done_when', 'The founder approved the shorts batch.'),
    0, null, '{}', p_created_by);
  return v_id;
end;
$$;
revoke all on function public.cut_shorts_order_for(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.cut_shorts_order(p_clip_id uuid)
returns uuid language plpgsql volatile security definer set search_path = public
as $$
begin
  return public.cut_shorts_order_for(public.require_user(), p_clip_id, 'founder');
end;
$$;
revoke all on function public.cut_shorts_order(uuid) from public, anon;
grant execute on function public.cut_shorts_order(uuid) to authenticated;

-- The Builder's output in one transaction: the batch, and per short its own edit (a `clips` row of kind `short` under
-- the parent's job, with the parent's library so its media resolves) and its `shorts` row. Refused unless the parent
-- is still finished at the hash the shorts were cut from. Items: source_start, source_end, hook, title, reason,
-- document. Answers `{batch_id, shorts: [{short_id, short_clip_id}]}` in input order.
create or replace function public.short_batch_create(p_parent_clip_id uuid, p_parent_hash text, p_order_id uuid,
  p_shorts jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_parent public.clips := public.owned_clip(p_parent_clip_id, v_user);
  v_project public.editor_projects;
  v_batch uuid;
  v_item jsonb;
  v_clip uuid;
  v_short uuid;
  v_idx integer;
  v_out jsonb := '[]'::jsonb;
  v_start numeric;
  v_end numeric;
begin
  if not public.studio_brain_call() then
    raise exception 'Only OpenCMO''s Studio team can do this.' using errcode = '42501';
  end if;
  if v_parent.kind = 'short' then
    raise exception 'A short is not cut into shorts.' using errcode = 'P0001';
  end if;
  select * into v_project from public.editor_projects where clip_id = p_parent_clip_id for update;
  if not found or p_parent_hash is null or v_project.finished_hash is distinct from p_parent_hash
     or p_parent_hash is distinct from public.editor_document_hash(v_project.document) then
    raise exception 'This edit changed after it was marked finished. Mark it finished again to cut shorts.' using errcode = 'P0001';
  end if;
  if p_order_id is not null and not exists (select 1 from public.work_orders where id = p_order_id and user_id = v_user) then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if p_shorts is null or jsonb_typeof(p_shorts) <> 'array' or jsonb_array_length(p_shorts) not between 1 and 3 then
    raise exception 'A batch has 1 to 3 shorts.' using errcode = '22023';
  end if;
  -- One batch at a time per finished version: a retry of the same cut does not double it.
  if exists (select 1 from public.short_batches where parent_clip_id = p_parent_clip_id and parent_hash = p_parent_hash
             and status not in ('sent_back', 'failed', 'cancelled')) then
    raise exception 'Shorts are already being cut from this version.' using errcode = 'P0001';
  end if;
  -- Short edits take the next free negative index of the parent's job (uploads use 0 and up, blank edits -1).
  perform 1 from public.jobs where id = v_parent.job_id for update;
  insert into public.short_batches (user_id, parent_clip_id, parent_hash, order_id, status)
  values (v_user, p_parent_clip_id, p_parent_hash, p_order_id, 'rendering')
  returning id into v_batch;
  for v_item in select * from jsonb_array_elements(p_shorts) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'document') is distinct from 'object'
       or jsonb_typeof(v_item->'source_start') is distinct from 'number' or jsonb_typeof(v_item->'source_end') is distinct from 'number'
       or char_length(coalesce(v_item->>'hook', '')) not between 1 and 120
       or char_length(coalesce(v_item->>'title', '')) not between 1 and 60
       or char_length(coalesce(v_item->>'reason', '')) not between 1 and 300 then
      raise exception 'A short needs its range, hook, title, reason and edit.' using errcode = '22023';
    end if;
    v_start := (v_item->>'source_start')::numeric;
    v_end := (v_item->>'source_end')::numeric;
    v_idx := (select least(coalesce(min(idx), 0), -1) - 1 from public.clips where job_id = v_parent.job_id);
    insert into public.clips (job_id, idx, hook, start_seconds, end_seconds, kind, parent_clip_id)
    values (v_parent.job_id, v_idx, v_item->>'title', 0, v_end - v_start, 'short', p_parent_clip_id)
    returning id into v_clip;
    insert into public.editor_projects (clip_id, document, manifest)
    values (v_clip, v_item->'document', v_project.manifest);
    -- Edited and voice-over transcripts are stored per clip: the short's captions read the parent's.
    insert into public.editor_transcripts (clip_id, hash, body)
    select v_clip, t.hash, t.body from public.editor_transcripts t
    where t.clip_id = p_parent_clip_id
      and t.hash in (select (regexp_matches((v_item->'document')::text, 'assets/transcripts/([0-9a-f]{64})\.json', 'g'))[1])
    on conflict do nothing;
    insert into public.shorts (user_id, batch_id, parent_clip_id, short_clip_id, source_start, source_end, hook, reason, status)
    values (v_user, v_batch, p_parent_clip_id, v_clip, v_start, v_end, v_item->>'hook', v_item->>'reason', 'rendering')
    returning id into v_short;
    v_out := v_out || jsonb_build_array(jsonb_build_object('short_id', v_short, 'short_clip_id', v_clip));
  end loop;
  return jsonb_build_object('batch_id', v_batch, 'shorts', v_out);
end;
$$;
revoke all on function public.short_batch_create(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.short_batch_create(uuid, text, uuid, jsonb) to authenticated;

-- Same as 20261228090000, except a short whose render failed is not on the batch card: the founder approves what
-- they can watch.
create or replace function public.approval_snapshot(p_ref_kind text, p_ref_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v jsonb;
begin
  case p_ref_kind
    when 'content_item' then
      select jsonb_build_object('kind', 'post', 'platform', platform, 'day', day, 'idea', idea,
        'text', coalesce(body->>'text', ''),
        'alternates', case when jsonb_typeof(body->'alternates') = 'array' then body->'alternates' else '[]'::jsonb end,
        'rationale', coalesce(body->>'rationale', reason))
      into v from public.content_items where id = p_ref_id;
    when 'opportunity' then
      select jsonb_build_object('kind', 'reply', 'url', url, 'community', community, 'title', title,
        'reply', reply, 'score', score, 'score_parts', score_parts)
      into v from public.opportunities where id = p_ref_id;
    when 'goal' then
      select jsonb_build_object('kind', 'goal', 'week', week, 'goal', goal, 'metric', metric, 'target', target)
      into v from public.cmo_goals where id = p_ref_id;
    when 'correction' then
      select jsonb_build_object('kind', 'correction', 'rule', rule, 'source_edits', source_edits)
      into v from public.cmo_corrections where id = p_ref_id;
    when 'studio_step' then
      select case s.kind
        when 'script' then jsonb_build_object('kind', 'script', 'step_id', s.id, 'clip_id', s.clip_id, 'tool', s.tool,
          'title', coalesce(s.card->>'title', ''), 'seconds', s.card->'seconds', 'aspect', s.card->'aspect',
          'beats', case when jsonb_typeof(s.card->'beats') = 'array' then s.card->'beats' else '[]'::jsonb end,
          'price_credits', s.price_credits)
        else jsonb_build_object('kind', 'price', 'step_id', s.id, 'clip_id', s.clip_id, 'tool', s.tool,
          'title', coalesce(s.card->>'title', ''), 'what', coalesce(s.card->>'what', ''), 'seconds', s.card->'seconds',
          'wait_minutes', s.card->'wait_minutes',
          'keyframes', case when jsonb_typeof(s.card->'keyframes') = 'array' then s.card->'keyframes' else '[]'::jsonb end,
          'shots', coalesce(s.card->'shots', '0'::jsonb), 'price_credits', s.price_credits)
        end
      into v from public.studio_steps s where s.id = p_ref_id;
    when 'editor_project' then
      select jsonb_build_object('kind', 'finished_video', 'clip_id', c.id, 'title', coalesce(c.hook, ''),
        'document_hash', public.editor_document_hash(p.document),
        'render_task_id', r.id, 'render_path', r.output_path, 'seconds', r.duration)
      into v
      from public.editor_projects p
      join public.clips c on c.id = p.clip_id
      left join lateral (
        select t.id, t.output_path, t.duration from public.tasks t
        where t.clip_id = p.clip_id and t.kind = 'render_document' and t.status = 'done'
          and t.settings_hash = public.editor_document_hash(p.document)
        order by t.finished_at desc nulls last, t.created_at desc
        limit 1
      ) r on true
      where p.clip_id = p_ref_id;
    when 'short_batch' then
      select jsonb_build_object('kind', 'shorts_batch', 'batch_id', b.id, 'parent_clip_id', b.parent_clip_id,
        'title', coalesce(c.hook, ''), 'parent_hash', b.parent_hash,
        'shorts', coalesce((
          select jsonb_agg(jsonb_build_object('short_id', s.id, 'short_clip_id', s.short_clip_id,
            'start', s.source_start, 'end', s.source_end, 'hook', s.hook, 'reason', s.reason)
            order by s.source_start, s.id)
          from public.shorts s where s.batch_id = b.id and s.status <> 'failed'), '[]'::jsonb))
      into v
      from public.short_batches b
      left join public.clips c on c.id = b.parent_clip_id
      where b.id = p_ref_id;
    else
      raise exception 'Unknown card source.' using errcode = '22023';
  end case;
  return v;
end;
$$;
revoke all on function public.approval_snapshot(text, uuid) from public, anon, authenticated;

-- Any edit after "Mark finished" clears it. BEFORE: the row is written once, already cleared.
create or replace function public.editor_projects_clear_finished() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.finished_hash is not null and new.document is distinct from old.document
     and public.editor_document_hash(new.document) is distinct from new.finished_hash then
    new.finished_at := null;
    new.finished_hash := null;
  end if;
  return new;
end;
$$;
revoke all on function public.editor_projects_clear_finished() from public, anon, authenticated;
create trigger editor_projects_clear_finished before update of document on public.editor_projects
  for each row execute function public.editor_projects_clear_finished();

-- The rules on `editor_projects`: a newly finished edit gets its `cut_shorts` order; a changed document closes a waiting
-- card 3 (it showed another version; the next render raises a new one). A fault here never fails the save.
create or replace function public.editor_projects_rules() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
begin
  if new.document is distinct from old.document then
    perform public.approval_close('editor_project', new.clip_id, 'cancelled');
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
revoke all on function public.editor_projects_rules() from public, anon, authenticated;
create trigger editor_projects_rules after update on public.editor_projects
  for each row execute function public.editor_projects_rules();

-- The rules on renders. A short's render moves its short and, once none is rendering, the batch: some ready → the
-- batch card waits on the founder; none → the batch and its order fail. A render of a video order's edit at its
-- current document raises card 3; a failed one fails the order with the worker's reason. Never fails the worker.
-- Once no short of a batch is still rendering: the batch card when any short is ready, else the batch and its
-- order fail. Called when a render task ends and when a render is refused before it was queued.
create or replace function public.short_batch_settle(p_batch_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_batch public.short_batches;
begin
  select * into v_batch from public.short_batches where id = p_batch_id for update;
  if not found or v_batch.status <> 'rendering' or exists (
      select 1 from public.shorts where batch_id = v_batch.id and status in ('building', 'rendering')) then
    return;
  end if;
  if exists (select 1 from public.shorts where batch_id = v_batch.id and status = 'ready') then
    update public.short_batches set status = 'waiting_founder' where id = v_batch.id;
    perform public.approval_raise(v_batch.user_id, 'short_batch', v_batch.id);
    if v_batch.order_id is not null then
      perform public.work_order_wait_founder(v_batch.order_id, 'Shorts are ready for you');
    end if;
  else
    update public.short_batches set status = 'failed', error = 'Every short failed to render.' where id = v_batch.id;
    if v_batch.order_id is not null and exists (select 1 from public.work_orders
        where id = v_batch.order_id and status not in ('done', 'failed', 'cancelled')) then
      perform public.work_order_move(v_batch.order_id, 'failed', null,
        jsonb_build_object('code', 'render_failed', 'message', 'Every short failed to render.', 'retryable', true));
    end if;
  end if;
end;
$$;
revoke all on function public.short_batch_settle(uuid) from public, anon, authenticated;

-- The Renderer could not queue a short's render (daily export limit, too many in flight): the short fails now,
-- so its batch settles instead of waiting on a task that will never exist.
create or replace function public.short_render_refused(p_short_id uuid) returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_short public.shorts;
begin
  if not public.studio_brain_call() then
    raise exception 'Only OpenCMO''s Studio team can do this.' using errcode = '42501';
  end if;
  select * into v_short from public.shorts where id = p_short_id and user_id = v_user for update;
  if not found then
    raise exception 'Short not found.' using errcode = 'P0002';
  end if;
  if v_short.status <> 'rendering' then
    return;
  end if;
  update public.shorts set status = 'failed' where id = v_short.id;
  perform public.short_batch_settle(v_short.batch_id);
end;
$$;
revoke all on function public.short_render_refused(uuid) from public, anon;
grant execute on function public.short_render_refused(uuid) to authenticated;

create or replace function public.tasks_studio_rules() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_short public.shorts;
  v_order uuid;
  v_user uuid;
begin
  if new.kind <> 'render_document' or new.status not in ('done', 'failed') or old.status = new.status or new.clip_id is null then
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
      return new;
    end if;
    if new.status = 'done' then
      if new.settings_hash = (select public.editor_document_hash(document) from public.editor_projects where clip_id = new.clip_id) then
        perform public.approval_raise(v_user, 'editor_project', new.clip_id);
        perform public.work_order_wait_founder(v_order, 'Your video is rendered');
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
revoke all on function public.tasks_studio_rules() from public, anon, authenticated;
create trigger tasks_studio_rules after update of status on public.tasks
  for each row execute function public.tasks_studio_rules();

-- Same as 20261228100000 plus the shorts batch, and card 3 of a video order finishing the order with its deliverable.
create or replace function public.approval_decide(p_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns public.approvals language plpgsql volatile security definer set search_path = public
as $$
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

  perform set_config('opencmo.decided_via', v_via, true);
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
      perform public.cmo_decide_opportunity(v_row.ref_id, p_action, v_payload->>'reason');
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
      if (v_row.kind = 'script' and p_action not in ('approve', 'edit', 'cancel'))
         or (v_row.kind = 'price' and p_action not in ('approve', 'redo', 'cancel')) then
        raise exception '%', case v_row.kind when 'script' then 'Choose approve, edit a beat or cancel.'
          else 'Choose approve, redo a keyframe or cancel.' end using errcode = '22023';
      end if;
      select * into v_step from public.studio_steps where id = v_row.ref_id and user_id = v_user for update;
      if not found or v_step.status <> 'waiting' then
        raise exception 'This card was already decided.' using errcode = 'P0001';
      end if;
      if p_action = 'edit' then
        if jsonb_typeof(v_payload->'beat') is distinct from 'number'
           or (v_payload->>'beat')::numeric <> trunc((v_payload->>'beat')::numeric) then
          raise exception 'Say which beat to change.' using errcode = '22023';
        end if;
        v_n := (v_payload->>'beat')::numeric::integer;
        v_text := trim(coalesce(v_payload->>'text', ''));
        if v_n < 0 or v_n >= jsonb_array_length(v_row.snapshot->'beats') then
          raise exception 'That beat is not in the script.' using errcode = '22023';
        end if;
        if char_length(v_text) not between 1 and 300 then
          raise exception 'A beat''s words are 1 to 300 characters.' using errcode = '22023';
        end if;
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
$$;
revoke all on function public.approval_decide(uuid, text, jsonb) from public, anon;
grant execute on function public.approval_decide(uuid, text, jsonb) to authenticated;

commit;
