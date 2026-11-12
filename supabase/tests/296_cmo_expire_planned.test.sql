-- 20270118010000: planned posts and scans more than two days late leave the calendar, with their open orders
-- cancelled; drafts, video items, recent items and items a run already named stay.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

select ok(has_function_privilege('service_role', 'public.cmo_expire_planned(integer)', 'execute'), 'the schedule can call it');
select ok(not has_function_privilege('authenticated', 'public.cmo_expire_planned(integer)', 'execute'), 'a founder cannot');
select ok(not has_function_privilege('anon', 'public.cmo_expire_planned(integer)', 'execute'), 'anon cannot');

insert into auth.users (id, email) values ('e2960000-0000-4000-8000-00000000000a', 'expire@test.local');

insert into public.content_items (id, user_id, department, platform, day, idea, status) values
  ('e2962000-0000-4000-8000-000000000001', 'e2960000-0000-4000-8000-00000000000a', 'post', 'X', current_date - 3, 'Three days late', 'planned'),
  ('e2962000-0000-4000-8000-000000000002', 'e2960000-0000-4000-8000-00000000000a', 'post', 'X', current_date - 2, 'Two days late', 'planned'),
  ('e2962000-0000-4000-8000-000000000003', 'e2960000-0000-4000-8000-00000000000a', 'post', 'X', current_date - 9, 'Late, in review', 'in_review'),
  ('e2962000-0000-4000-8000-000000000004', 'e2960000-0000-4000-8000-00000000000a', 'video', 'TikTok', current_date - 9, 'A late script', 'planned'),
  ('e2962000-0000-4000-8000-000000000005', 'e2960000-0000-4000-8000-00000000000a', 'sales', 'Reddit', current_date - 5, 'A late scan', 'planned'),
  ('e2962000-0000-4000-8000-000000000006', 'e2960000-0000-4000-8000-00000000000a', 'post', 'Threads', current_date - 4, 'Late, with a run', 'planned');

-- The week's tree holds an open order for the late post.
do $do$ begin
  perform public.work_order_create('e2960000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
    (public.work_order_week_root('e2960000-0000-4000-8000-00000000000a')).id, 'post_draft', 'Three days late',
    '{"objective":"Three days late","done_when":"A draft waits on the founder''s card."}'::jsonb, 0, null, '{}', 'loop',
    'e2962000-0000-4000-8000-000000000001');
end $do$;

-- A run that already named the Threads post keeps it.
insert into public.cmo_runs (user_id, kind, status, input, credits)
values ('e2960000-0000-4000-8000-00000000000a', 'post_draft', 'queued', '{"item_id":"e2962000-0000-4000-8000-000000000006"}', 0);

select throws_ok($$ select public.cmo_expire_planned(0) $$, '22023', 'Invalid number of days.', 'zero days is refused');

select is(public.cmo_expire_planned(), 2, 'the late post and the late scan are dropped');
select is((select count(*)::int from public.content_items where id in ('e2962000-0000-4000-8000-000000000001', 'e2962000-0000-4000-8000-000000000005')), 0,
  'both are gone from the calendar');
select is((select status from public.work_orders where title = 'Three days late' and kind = 'post_draft'
           and user_id = 'e2960000-0000-4000-8000-00000000000a'), 'cancelled', 'the open order of the late post is cancelled');
select is((select status from public.content_items where id = 'e2962000-0000-4000-8000-000000000002'), 'planned', 'two days late still gets its draft');
select is((select status from public.content_items where id = 'e2962000-0000-4000-8000-000000000003'), 'in_review', 'a draft in review is never touched');
select is((select status from public.content_items where id = 'e2962000-0000-4000-8000-000000000004'), 'planned', 'a script waits on the founder, however late');
select is((select status from public.content_items where id = 'e2962000-0000-4000-8000-000000000006'), 'planned', 'an item a queued run named is left to that run');

select is(public.cmo_expire_planned(), 0, 'a second call drops nothing');

select * from finish();
rollback;
