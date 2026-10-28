-- 20261228100000: P2 A1, Studio steps behind cards (plan F3, F5; sessions/A.md A1).
--
-- A priced Studio step is stored by `studio_step_raise` (the adapter's `plan`, under the founder's session; nothing is
-- held) and raises its card. `approval_decide` decides it: the SQL records the decision, and the route then runs the
-- step through the adapter (`decide`), which holds and spends credits as the Assistant does today; the adapter reports
-- back with `studio_step_finish`. A trigger keeps the card in step with the row, as wave 1 does for posts.
--
-- Decisions, as `components/cards/decide.ts` sends them:
--   script: approve | edit {beat, text} | cancel      price: approve | redo {index} | cancel
--   finished_video: approve (= mark_finished at the card's document hash) | send_back {reason}
-- `edit` and `redo` close the card as `edited`: the adapter re-plans (a new beat) or makes one keyframe again, and a
-- new card supersedes this one; the order keeps waiting. `cancel` stops the video and its order; a waiting step holds
-- nothing, so there is nothing to release.

begin;

-- Why a card was sent back, skipped or edited: the brain reads it, and the next eval cases come from it.
alter table public.approvals add column reason text check (char_length(reason) <= 400);

alter table public.studio_steps add column decision text check (decision in ('approve', 'edit', 'redo', 'cancel'));
alter table public.studio_steps add column decision_payload jsonb
  check (decision_payload is null or (jsonb_typeof(decision_payload) = 'object' and octet_length(decision_payload::text) <= 2048));
-- The generation a running step waits on (keyframes, shots): the order resumes when it is done (A2).
alter table public.studio_steps add column generation_id uuid;

-- The card follows the row: a waiting step raises (or supersedes) its card; leaving `waiting` closes it with what the
-- founder chose. Whatever path moves the row (decide, the adapter, a cancelled order), the card is never left behind.
create or replace function public.studio_steps_sync() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.approval_close('studio_step', old.id, 'cancelled');
    return old;
  end if;
  if new.status = 'waiting' then
    perform public.approval_raise(new.user_id, 'studio_step', new.id);
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'waiting' then
    return new;
  end if;
  perform public.approval_close('studio_step', new.id, case new.decision
    when 'approve' then 'approved' when 'edit' then 'edited' when 'redo' then 'edited' when 'cancel' then 'skipped'
    else 'cancelled' end);
  return new;
end;
$$;
revoke all on function public.studio_steps_sync() from public, anon, authenticated;
create trigger studio_steps_sync after insert or update or delete on public.studio_steps
  for each row execute function public.studio_steps_sync();

-- The adapter's `plan` → a waiting step and its card. Runs under the founder's session (the brain mints a user JWT,
-- as MCP does), so ownership is the clip's. Holds nothing: credits are held when the step runs.
create or replace function public.studio_step_raise(p_clip_id uuid, p_tool text, p_kind text, p_input jsonb, p_card jsonb,
  p_price_credits integer, p_order_id uuid default null, p_redo_of uuid default null)
returns public.studio_steps language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_row public.studio_steps;
begin
  perform public.owned_clip(p_clip_id, v_user);
  if p_tool is null or p_tool not in ('generate_media', 'add_3d_scene', 'add_voiceover', 'replace_background',
      'create_video', 'animate_video', 'redo_keyframe', 'edit_video', 'add_explainer', 'plan_video', 'request_export',
      'add_captions', 'translate_captions') then
    raise exception 'This Studio tool is not priced on a card.' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('script', 'price') or (p_kind = 'script' and p_tool not in ('create_video', 'plan_video')) then
    raise exception 'Only a storyboard is a script card.' using errcode = '22023';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or p_card is null or jsonb_typeof(p_card) <> 'object' then
    raise exception 'This step is malformed.' using errcode = '22023';
  end if;
  -- A price card always says how long the video is (a redone keyframe too: the video it belongs to).
  if (p_kind = 'script' and jsonb_typeof(p_card->'beats') is distinct from 'array')
     or (p_kind = 'price' and (jsonb_typeof(p_card->'seconds') is distinct from 'number' or (p_card->>'seconds')::numeric <= 0
       or (p_card ? 'keyframes' and jsonb_typeof(p_card->'keyframes') <> 'array'))) then
    raise exception 'This step is malformed.' using errcode = '22023';
  end if;
  if p_price_credits is null or p_price_credits < 0 then
    raise exception 'A step needs its price.' using errcode = '22023';
  end if;
  if p_order_id is not null and not exists (select 1 from public.work_orders where id = p_order_id and user_id = v_user) then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if p_redo_of is not null and not exists (
      select 1 from public.studio_steps where id = p_redo_of and user_id = v_user and clip_id = p_clip_id) then
    raise exception 'The step this replaces was not found.' using errcode = 'P0002';
  end if;
  -- Cards are few by design (approval.md rule 3); a loop raising cards without end stops here.
  if (select count(*) from public.studio_steps where user_id = v_user and status = 'waiting') >= 20 then
    raise exception 'Too many Studio cards are waiting. Decide some first.' using errcode = 'P0001';
  end if;
  insert into public.studio_steps (user_id, clip_id, tool, kind, input, card, price_credits, order_id, redo_of)
  values (v_user, p_clip_id, p_tool, p_kind, p_input, p_card, p_price_credits, p_order_id, p_redo_of)
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.studio_step_raise(uuid, text, text, jsonb, jsonb, integer, uuid, uuid) from public, anon;
grant execute on function public.studio_step_raise(uuid, text, text, jsonb, jsonb, integer, uuid, uuid) to authenticated;

-- The adapter reports what a decided step did. Only `approval_decide` approves a step; this never does.
create or replace function public.studio_step_finish(p_id uuid, p_status text, p_error text default null,
  p_generation_id uuid default null)
returns public.studio_steps language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_row public.studio_steps;
  v_ok boolean;
begin
  select * into v_row from public.studio_steps where id = p_id and user_id = v_user for update;
  if not found then
    raise exception 'Step not found.' using errcode = 'P0002';
  end if;
  if v_row.status = p_status then
    return v_row;
  end if;
  v_ok := case v_row.status
    when 'waiting' then p_status = 'cancelled'
    when 'approved' then p_status in ('running', 'done', 'failed', 'cancelled')
    when 'running' then p_status in ('done', 'failed', 'cancelled')
    else false end;
  if not coalesce(v_ok, false) then
    raise exception 'A step cannot go from % to %.', v_row.status, p_status using errcode = 'P0001';
  end if;
  if p_status = 'failed' and nullif(trim(coalesce(p_error, '')), '') is null then
    raise exception 'A failed step needs its error.' using errcode = '22023';
  end if;
  update public.studio_steps
  set status = p_status,
      decision = case when v_row.status = 'waiting' then 'cancel' else decision end,
      decided_at = coalesce(decided_at, now()),
      error = case when p_status = 'failed' then left(p_error, 500) else error end,
      generation_id = coalesce(p_generation_id, generation_id)
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.studio_step_finish(uuid, text, text, uuid) from public, anon;
grant execute on function public.studio_step_finish(uuid, text, text, uuid) to authenticated;

-- "Mark finished" (the editor, Studio, or approving card 3): the edit is finished at the document the founder saw.
-- A changed document refuses, so the founder never finishes a version they did not look at. Shorts are cut only from
-- a finished edit; any later edit clears the mark (save_editor_document, A3).
create or replace function public.mark_finished(p_clip_id uuid, p_document_hash text)
returns public.editor_projects language plpgsql volatile security definer set search_path = public
as $$
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
  select s.order_id into v_order from public.studio_steps s join public.work_orders o on o.id = s.order_id
  where s.clip_id = p_clip_id and o.kind = 'build_video' and o.status not in ('done', 'failed', 'cancelled')
  order by s.created_at desc limit 1;
  if v_order is not null then
    insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
    values (v_user, v_order, 'video', 'clip', p_clip_id, 'decided')
    on conflict (ref_kind, ref_id) do nothing;
    perform public.work_order_move(v_order, 'done', 'Finished “' || coalesce(nullif((select hook from public.clips where id = p_clip_id), ''), 'the video') || '”');
  end if;
  return v_row;
end;
$$;
revoke all on function public.mark_finished(uuid, text) from public, anon;
grant execute on function public.mark_finished(uuid, text) to authenticated;

-- Same as 20261227100000 plus Studio's kinds. `p_payload` adds `beat` + `text` (script edit), `index` (price redo)
-- and `reason` (any decline). A Studio decision only records the choice here; the route runs the step afterwards.
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
        if jsonb_typeof(v_payload->'target') <> 'number' then
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
        if jsonb_typeof(v_payload->'beat') is distinct from 'number' then
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
        update public.studio_steps set status = 'cancelled', decision = 'edit', decided_at = now(),
          decision_payload = jsonb_build_object('beat', v_n, 'text', v_text)
        where id = v_step.id;
      elsif p_action = 'redo' then
        if jsonb_typeof(v_payload->'index') is distinct from 'number' then
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
        -- Cancelling a card stops the video it belongs to.
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
        perform public.mark_finished(v_row.ref_id, v_row.snapshot->>'document_hash');
      else
        -- The edit stays open: the founder tweaks it in the editor, and the next render raises a new card.
        perform public.approval_close(v_row.ref_kind, v_row.ref_id, 'skipped');
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
