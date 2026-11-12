-- 20270120020000: one core post a slot, scheduled on every platform the planner picked. A target with a connected
-- account publishes, one without is copy and open; an old item without targets keeps its one platform; a draft keeps
-- the planner's targets.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(14);

select ok(not has_function_privilege('authenticated', 'public.post_targets(uuid)', 'execute'), 'a founder cannot call post_targets');
select ok(not has_function_privilege('anon', 'public.post_targets(uuid)', 'execute'), 'anon cannot');
select is(public.platform_profile('core')->>'kind', 'core', 'the core profile is there');
select is((public.platform_profile('x')->>'limit')::int, 4000, 'X takes a long post (D6): as long as an approved post is kept');

insert into auth.users (id, email) values
  ('e3000000-0000-4000-8000-00000000000a', 'targets-a@test.local'),
  ('e3000000-0000-4000-8000-00000000000b', 'targets-b@test.local');
update public.profiles set plan = 'starter', timezone = 'UTC'
where id in ('e3000000-0000-4000-8000-00000000000a', 'e3000000-0000-4000-8000-00000000000b');
-- Founder A has X connected; founder B has no account at all.
select public.zernio_profile_save('e3000000-0000-4000-8000-00000000000a', 'prof-targets');
select public.social_account_save('e3000000-0000-4000-8000-00000000000a', 'x', '@founder', null, 'acc-targets-x');

insert into public.work_orders (id, user_id, week, kind, title, brief, department, status) values
  ('e3001000-0000-4000-8000-00000000000a', 'e3000000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
   'post_draft', 'Posts', '{}', 'writer', 'done'),
  ('e3001000-0000-4000-8000-00000000000b', 'e3000000-0000-4000-8000-00000000000b', date_trunc('week', current_date)::date,
   'post_draft', 'Posts', '{}', 'writer', 'done');

-- An approved post and its deliverable (whose insert proposes its slots); returns how many slots it has.
create function pg_temp.approve(p_user uuid, p_order uuid, p_item uuid, p_platform text, p_body jsonb) returns integer
language plpgsql as $$
declare
  v_d uuid;
begin
  insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
  values (p_item, p_user, 'post', p_platform, current_date, 'A post', 'approved', p_body);
  insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, status)
  values (p_user, p_order, 'post', 'content_item', p_item, 'decided') returning id into v_d;
  perform public.schedule_propose(v_d);
  return (select count(*)::int from public.schedule_slots where deliverable_id = v_d);
end;
$$;
create function pg_temp.slots(p_item uuid) returns text language sql as $$
  select string_agg(s.platform || ' ' || s.mode, ', ' order by s.platform) from public.schedule_slots s
  join public.deliverables d on d.id = s.deliverable_id where d.ref_id = p_item;
$$;

select is(pg_temp.approve('e3000000-0000-4000-8000-00000000000a', 'e3001000-0000-4000-8000-00000000000a',
  'e3002000-0000-4000-8000-000000000001', 'X', '{"text":"One core post.","targets":["x","linkedin"]}'), 2,
  'a post with two targets gets two slots');
select is(pg_temp.slots('e3002000-0000-4000-8000-000000000001'), 'linkedin intent, x publish',
  'X goes out from the connected account, LinkedIn is copy and open');
select is((select count(*)::int from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  join public.deliverables d on d.id = s.deliverable_id
  where a.ref_kind = 'schedule_slot' and d.ref_id = 'e3002000-0000-4000-8000-000000000001'), 2, 'each target has its schedule card');

-- Review Focus 5: an item made before the posting plan has no targets and keeps its one platform.
select is(public.post_targets('e3002000-0000-4000-8000-000000000001'), array['x', 'linkedin'], 'targets in the planner''s order');
select is(pg_temp.approve('e3000000-0000-4000-8000-00000000000a', 'e3001000-0000-4000-8000-00000000000a',
  'e3002000-0000-4000-8000-000000000002', 'Threads', '{"text":"An old post."}'), 1, 'an old item gets one slot');
select is(pg_temp.slots('e3002000-0000-4000-8000-000000000002'), 'threads intent', 'on its own platform');

-- Review Focus 1: no account at all, every target is copy and open; nothing errors.
select is(pg_temp.approve('e3000000-0000-4000-8000-00000000000b', 'e3001000-0000-4000-8000-00000000000b',
  'e3002000-0000-4000-8000-000000000003', 'X', '{"text":"Three platforms.","targets":["x","threads","linkedin"]}'), 3,
  'three targets, three slots');
select is(pg_temp.slots('e3002000-0000-4000-8000-000000000003'), 'linkedin intent, threads intent, x intent',
  'without an account every slot is copy and open');

-- The draft replaces the body but keeps the planner's targets and slot.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
values ('e3002000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Planned',
  'planned', '{"targets":["x","threads"],"slot":1}');
select is((select body - 'proposed' from public.cmo_save_draft('e3000000-0000-4000-8000-00000000000a', null,
  'e3002000-0000-4000-8000-000000000004', 'Planned', '{"text":"The draft.","targets":["linkedin"]}')),
  '{"text":"The draft.","targets":["x","threads"],"slot":1}'::jsonb, 'the draft keeps the planner''s targets and slot');
select is((select body - 'proposed' from public.cmo_save_draft('e3000000-0000-4000-8000-00000000000a', null, null, 'A brief',
  '{"text":"From a brief."}')), '{"text":"From a brief."}'::jsonb, 'a post from a brief has no targets');

select * from finish();
rollback;
