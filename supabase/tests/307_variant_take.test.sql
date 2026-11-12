-- 20270120045000: the post card's approved time is taken by its slot only when that slot posts the core text the card
-- showed. A slot that posts a rewrite gets its own schedule card.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(4);

insert into auth.users (id, email) values ('e3070000-0000-4000-8000-00000000000a', 'take@test.local');
update public.profiles set plan = 'starter', timezone = 'UTC' where id = 'e3070000-0000-4000-8000-00000000000a';
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status) values
  ('e3071000-0000-4000-8000-00000000000a', 'e3070000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
   'post_draft', 'Posts', '{}', 'writer', 'done');

-- An approved post whose card carried a time on X (copy and open: no account); `p_variant` adds X's rewrite.
create function pg_temp.slot(p_item uuid, p_hour int, p_variant boolean) returns public.schedule_slots language plpgsql as $$
declare
  v_slot public.schedule_slots;
  v_text text := 'The core post ' || p_hour;
begin
  insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
  values (p_item, 'e3070000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'A post', 'approved',
    jsonb_build_object('text', v_text, 'targets', jsonb_build_array('x'), 'proposed', jsonb_build_object(
      'platform', 'x', 'mode', 'intent', 'account_id', null, 'handle', null,
      'at', to_char(date_trunc('day', now()) + make_interval(days => 3, hours => p_hour), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
  if p_variant then
    insert into public.post_variants (user_id, item_id, platform, text, source_hash)
    values ('e3070000-0000-4000-8000-00000000000a', p_item, 'x', 'The rewrite for X', public.post_core_hash(v_text));
  end if;
  insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
  values ('e3070000-0000-4000-8000-00000000000a', 'e3071000-0000-4000-8000-00000000000a', 'post', 'content_item', p_item, 'decided');
  select s.* into v_slot from public.schedule_slots s join public.deliverables d on d.id = s.deliverable_id where d.ref_id = p_item;
  return v_slot;
end;
$$;

select is((pg_temp.slot('e3072000-0000-4000-8000-000000000001', 9, false)).status, 'waiting',
  'the core text takes the time approved on the post card');
select is((pg_temp.slot('e3072000-0000-4000-8000-000000000002', 13, true)).status, 'proposed',
  'a rewrite the card did not show waits on its own card');
select is((select count(*)::int from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  join public.deliverables d on d.id = s.deliverable_id
  where a.ref_kind = 'schedule_slot' and a.status = 'waiting' and d.ref_id = 'e3072000-0000-4000-8000-000000000002'), 1,
  'the rewrite''s slot has its schedule card');
select is((select a.snapshot->>'text' from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  join public.deliverables d on d.id = s.deliverable_id
  where a.ref_kind = 'schedule_slot' and d.ref_id = 'e3072000-0000-4000-8000-000000000002'), 'The rewrite for X',
  'the card shows the rewrite');

select * from finish();
rollback;
