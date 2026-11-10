-- CMO review 3, I1 (plan §8): a beat of the script edited in the editor's Script tab. The script has one home, the
-- Writer's order (`work_orders.brief.storyboard`): the card, the Writer screen, the Script tab and the prompter all
-- read it, so an edit made here is the script everywhere. The script card's approval snapshot is not touched: it
-- stays the record of what the founder approved.
--
-- The version is the order's `updated_at`, read with the script: a stale tab (another tab, the phone, the card) is
-- refused instead of overwriting words the founder did not see. The editor then changes that beat's marker comment
-- through its own op (`set_marker`), so the founder's Undo covers the edit.

create or replace function public.cmo_script_edit_beat(p_order uuid, p_beat integer, p_say text, p_show text, p_version timestamptz)
returns jsonb
  language plpgsql security definer
  set search_path to 'public'
as $$
declare
  v_user uuid := public.require_user();
  v_order public.work_orders;
  v_beats integer;
  v_say text := nullif(trim(coalesce(p_say, '')), '');
  v_show text := nullif(trim(coalesce(p_show, '')), '');
  v_beat jsonb;
begin
  select * into v_order from public.work_orders
  where id = p_order and user_id = v_user and kind = 'write_video_brief' for update;
  if not found or jsonb_typeof(v_order.brief->'storyboard') is distinct from 'array' then
    raise exception 'Script not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.approvals where user_id = v_user and ref_kind = 'work_order' and ref_id = v_order.id
                 and kind = 'script' and status in ('approved', 'edited')) then
    raise exception 'Approve the script first.' using errcode = 'P0001';
  end if;
  if p_version is distinct from v_order.updated_at then
    raise exception 'This script changed. Look at it again before editing.' using errcode = 'P0001';
  end if;
  v_beats := jsonb_array_length(v_order.brief->'storyboard');
  if p_beat is null or p_beat < 1 or p_beat > v_beats then
    raise exception 'That beat is not in this script.' using errcode = '22023';
  end if;
  if v_say is null and v_show is null then
    raise exception 'Write what to say or what to show.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_say, '')) > 300 or char_length(coalesce(v_show, '')) > 300 then
    raise exception 'Keep each line of a beat under 300 characters.' using errcode = '22023';
  end if;
  v_beat := (v_order.brief->'storyboard'->(p_beat - 1))
    || case when v_say is not null then jsonb_build_object('say', v_say) else '{}'::jsonb end
    || case when v_show is not null then jsonb_build_object('show', v_show) else '{}'::jsonb end;
  -- The order's brief is capped at 4096 bytes (`work_orders_brief_check`): say so in words before the constraint does.
  if octet_length(jsonb_set(v_order.brief, array['storyboard', (p_beat - 1)::text], v_beat)::text) > 4096 then
    raise exception 'This script is too long to save. Shorten this beat or another one.' using errcode = '22023';
  end if;
  update public.work_orders set brief = jsonb_set(brief, array['storyboard', (p_beat - 1)::text], v_beat), updated_at = clock_timestamp()
  where id = v_order.id
  returning * into v_order;
  insert into public.work_order_events (user_id, order_id, department, kind, text)
  values (v_user, v_order.id, 'writer', 'note', left('You edited beat ' || p_beat || ' of “' || coalesce(v_order.title, 'the script') || '”', 200));
  return jsonb_build_object('version', v_order.updated_at, 'beat', p_beat, 'say', v_beat->>'say', 'show', v_beat->>'show');
end;
$$;

revoke all on function public.cmo_script_edit_beat(uuid, integer, text, text, timestamptz) from public, anon;
grant execute on function public.cmo_script_edit_beat(uuid, integer, text, text, timestamptz) to authenticated, service_role;
