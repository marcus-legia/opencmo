-- 20270207020000: cmo_fill_day_slots fills only the day's missing post slots, once; any status takes a slot.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(10);

select ok(not has_function_privilege('authenticated', 'public.cmo_fill_day_slots(uuid,date,jsonb)', 'execute'), 'founders cannot fill slots');
select ok(not has_function_privilege('anon', 'public.cmo_fill_day_slots(uuid,date,jsonb)', 'execute'), 'anon cannot');
select ok(has_function_privilege('service_role', 'public.cmo_fill_day_slots(uuid,date,jsonb)', 'execute'), 'the schedule can');

insert into auth.users (id, email) values
  ('e3660000-0000-4000-8000-00000000000a', 'fill-a@test.local'),
  ('e3660000-0000-4000-8000-00000000000b', 'fill-b@test.local');
insert into public.profiles (id, email) values
  ('e3660000-0000-4000-8000-00000000000a', 'fill-a@test.local'),
  ('e3660000-0000-4000-8000-00000000000b', 'fill-b@test.local')
on conflict (id) do nothing;

-- Slot 0 was drafted, slot 1 skipped, slot 2 planned; slots 3 and 4 have nothing. Another founder's slot 3 is theirs.
insert into public.content_items (user_id, department, platform, day, idea, status, body) values
  ('e3660000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Drafted', 'in_review', '{"slot": 0, "targets": ["x", "threads"]}'),
  ('e3660000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Skipped', 'skipped', '{"slot": 1, "targets": ["x", "threads"]}'),
  ('e3660000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Planned', 'planned', '{"slot": 2, "targets": ["x"]}'),
  ('e3660000-0000-4000-8000-00000000000a', 'post', 'X', current_date - 1, 'Yesterday', 'planned', '{"slot": 3, "targets": ["x"]}'),
  ('e3660000-0000-4000-8000-00000000000b', 'post', 'X', current_date, 'Theirs', 'planned', '{"slot": 3, "targets": ["x"]}');

create temp table filled on commit drop as
select * from public.cmo_fill_day_slots('e3660000-0000-4000-8000-00000000000a', current_date, '[
  {"slot": 0, "targets": ["x", "threads"]}, {"slot": 1, "targets": ["x", "threads"]}, {"slot": 2, "targets": ["x"]},
  {"slot": 3, "targets": ["x"]}, {"slot": 4, "targets": ["x"]}]'::jsonb) as r;

select is((select count(*)::int from filled), 2, 'only the two missing slots are filled');
select is((select string_agg(r->>'slot', ',' order by r->>'slot') from filled), '3,4', 'each made item comes back with its slot');
select is((select string_agg((body->>'slot') || ':' || status || ':' || platform || ':' || (body->>'planned_from') || ':' || (body->>'news'), ', ' order by body->>'slot')
  from public.content_items where id in (select (r->>'id')::uuid from filled)), '3:planned:X:day_fill:hook, 4:planned:X:day_fill:hook',
  'each is a planned post for its slot, from the day fill, news hook');
select is((select count(*)::int from public.cmo_fill_day_slots('e3660000-0000-4000-8000-00000000000a', current_date, '[
  {"slot": 3, "targets": ["x"]}, {"slot": 4, "targets": ["x"]}]'::jsonb)), 0, 'a second call adds nothing');
select is((select count(*)::int from public.cmo_fill_day_slots('e3660000-0000-4000-8000-00000000000a', current_date, '[
  {"slot": 7, "targets": ["x"]}, {"slot": 0, "targets": ["myspace"]}]'::jsonb)), 0, 'a bad slot or bad targets are ignored');
select throws_ok($$ select * from public.cmo_fill_day_slots('e3660000-0000-4000-8000-00000000000a', current_date, '{"slot": 0}'::jsonb) $$,
  '22023', 'These slots are not valid.', 'the slots must be a list');
create temp table theirs on commit drop as
select * from public.cmo_fill_day_slots('e3660000-0000-4000-8000-00000000000b', current_date, '[{"slot": 0, "targets": ["threads", "linkedin"]}]'::jsonb) as r;
select is((select platform from public.content_items where id = (select (r->>'id')::uuid from theirs)), 'Threads', 'the platform is the first target''s label');

select * from finish();
rollback;
