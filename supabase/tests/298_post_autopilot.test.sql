-- 20270119010000: a post goes out without the founder's Approve only when they turned autopilot on for that
-- platform, on a connected account, after the review window; everything else keeps its ordinary card.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(24);

select ok(has_function_privilege('service_role', 'public.approval_auto_decide(integer)', 'execute'), 'the cron can approve for a founder');
select ok(not has_function_privilege('authenticated', 'public.approval_auto_decide(integer)', 'execute'), 'a founder cannot run it');
select ok(has_function_privilege('authenticated', 'public.save_autopilot(text[],smallint)', 'execute'), 'a founder sets their own switch');
select ok(not has_function_privilege('anon', 'public.save_autopilot(text[],smallint)', 'execute'), 'anon cannot');

insert into auth.users (id, email) values
  ('e2980000-0000-4000-8000-00000000000a', 'auto@test.local'),
  ('e2980000-0000-4000-8000-00000000000b', 'auto-free@test.local');
insert into public.profiles (id, email) values
  ('e2980000-0000-4000-8000-00000000000a', 'auto@test.local'),
  ('e2980000-0000-4000-8000-00000000000b', 'auto-free@test.local')
on conflict (id) do nothing;
update public.profiles set plan = 'starter', timezone = 'UTC' where id = 'e2980000-0000-4000-8000-00000000000a';

insert into public.social_accounts (id, user_id, platform, handle, zernio_account_id) values
  ('e2981000-0000-4000-8000-000000000001', 'e2980000-0000-4000-8000-00000000000a', 'x', 'founder', 'z-x-1');

-- A post in review with a time and the connected account, as Writer proposes it.
create function pg_temp.post(p_id uuid, p_hours integer, p_extra jsonb default '{}') returns void language sql as $$
  insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
  values (p_id, 'e2980000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'A post', 'in_review',
    jsonb_build_object('text', 'One true thing about the product.', 'proposed', jsonb_build_object(
      'platform', 'x', 'mode', 'publish', 'account_id', 'e2981000-0000-4000-8000-000000000001', 'handle', 'founder',
      'at', to_char(date_trunc('minute', now() + make_interval(hours => p_hours)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) || p_extra);
$$;
create function pg_temp.card(p_item uuid) returns public.approvals language sql as $$
  select * from public.approvals where ref_id = p_item and ref_kind = 'content_item' order by created_at desc limit 1;
$$;

-- Off by default: an ordinary card.
select pg_temp.post('e2982000-0000-4000-8000-000000000001', 48);
delete from public.approvals where user_id = 'e2980000-0000-4000-8000-00000000000a';
select public.approval_raise('e2980000-0000-4000-8000-00000000000a', 'content_item', 'e2982000-0000-4000-8000-000000000001');
select is((pg_temp.card('e2982000-0000-4000-8000-000000000001')).status, 'waiting', 'the post has a card');
select is((pg_temp.card('e2982000-0000-4000-8000-000000000001')).auto_at, null, 'autopilot is off by default: no countdown');

-- The switch: the founder's own, on a paid plan, for a connected platform.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2980000-0000-4000-8000-00000000000b"}';
select throws_ok($$ select public.save_autopilot(array['x'], 12::smallint) $$, 'P0402', null, 'a free account is asked for a plan');
set local request.jwt.claims = '{"sub":"e2980000-0000-4000-8000-00000000000a"}';
select throws_ok($$ select public.save_autopilot(array['linkedin'], 12::smallint) $$, 'P0001', 'Connect your LinkedIn account first.', 'a platform must be connected');
select throws_ok($$ select public.save_autopilot(array['reddit'], 12::smallint) $$, '22023', 'Posts go out on their own on X, Threads and LinkedIn only.', 'never Reddit');
select throws_ok($$ select public.save_autopilot(array['x'], 5::smallint) $$, '22023', 'Choose 6, 12 or 24 hours.', 'the window is 6, 12 or 24 hours');
select lives_ok($$ select public.save_autopilot(array['x'], 12::smallint) $$, 'on for X, 12 hours');
reset role;

-- A new draft counts down: 12 hours, or a quarter of an hour before its time when that is sooner.
select pg_temp.post('e2982000-0000-4000-8000-000000000002', 48);
select public.approval_raise('e2980000-0000-4000-8000-00000000000a', 'content_item', 'e2982000-0000-4000-8000-000000000002');
select ok((pg_temp.card('e2982000-0000-4000-8000-000000000002')).auto_at between now() + interval '11 hours 59 minutes' and now() + interval '12 hours 1 minute',
  'a post two days out goes out on its own in 12 hours');
-- The time rule, on the card's own words: approved a quarter of an hour before a post due sooner than the window, and
-- no countdown at all for a post due within the hour.
select is(public.post_autopilot_at('e2980000-0000-4000-8000-00000000000a', 'content_item', 'e2982000-0000-4000-8000-000000000002',
    jsonb_set((pg_temp.card('e2982000-0000-4000-8000-000000000002')).snapshot, '{proposed,at}', to_jsonb((now() + interval '3 hours')::text))),
  now() + interval '2 hours 45 minutes', 'a post due in three hours is approved a quarter of an hour before');
select is(public.post_autopilot_at('e2980000-0000-4000-8000-00000000000a', 'content_item', 'e2982000-0000-4000-8000-000000000002',
    jsonb_set((pg_temp.card('e2982000-0000-4000-8000-000000000002')).snapshot, '{proposed,at}', to_jsonb((now() + interval '50 minutes')::text))),
  null, 'a post due within the hour keeps its ordinary card');

-- What keeps its ordinary card: the founder's own brief, a thread, a post with no account.
select pg_temp.post('e2982000-0000-4000-8000-000000000004', 48, '{"source":"cmo_chat"}');
select public.approval_raise('e2980000-0000-4000-8000-00000000000a', 'content_item', 'e2982000-0000-4000-8000-000000000004');
select is((pg_temp.card('e2982000-0000-4000-8000-000000000004')).auto_at, null, 'a brief the founder wrote waits for them');
-- Threads is not connected: Writer proposes it as a post the founder makes by hand.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
values ('e2982000-0000-4000-8000-000000000005', 'e2980000-0000-4000-8000-00000000000a', 'post', 'Threads', current_date, 'By hand', 'in_review',
  jsonb_build_object('text', 'Posted by hand.'));
select public.approval_raise('e2980000-0000-4000-8000-00000000000a', 'content_item', 'e2982000-0000-4000-8000-000000000005');
select is((pg_temp.card('e2982000-0000-4000-8000-000000000005')).auto_at, null, 'a post on a platform that is not connected waits for the founder');

-- Before the window ends nothing is approved.
select is(public.approval_auto_decide(), 0, 'nothing is approved inside the window');

-- The window ends: the untouched post is approved as the founder would, and marked as nobody's decision.
update public.approvals set auto_at = now() - interval '1 minute' where ref_id = 'e2982000-0000-4000-8000-000000000002';
select is(public.approval_auto_decide(), 1, 'the post whose window is over is approved');
select is((select status || ' via ' || decided_via from public.approvals where ref_id = 'e2982000-0000-4000-8000-000000000002' order by created_at desc limit 1),
  'approved via auto', 'the card says it went out on its own');
select is((select status from public.content_items where id = 'e2982000-0000-4000-8000-000000000002'), 'approved', 'the post is approved');
select is((select auto from public.cmo_draft_outcomes where item_id = 'e2982000-0000-4000-8000-000000000002'), true, 'the outcome is not the founder''s taste');

-- A paused CMO approves nothing, and the card goes back to waiting on the founder.
select pg_temp.post('e2982000-0000-4000-8000-000000000003', 48);
select public.approval_raise('e2980000-0000-4000-8000-00000000000a', 'content_item', 'e2982000-0000-4000-8000-000000000003');
update public.approvals set auto_at = now() - interval '1 minute' where ref_id = 'e2982000-0000-4000-8000-000000000003' and status = 'waiting';
update public.profiles set cmo_paused_at = now() where id = 'e2980000-0000-4000-8000-00000000000a';
select is(public.approval_auto_decide(), 0, 'a paused CMO approves nothing');
select is((pg_temp.card('e2982000-0000-4000-8000-000000000003')).status || coalesce((pg_temp.card('e2982000-0000-4000-8000-000000000003')).auto_at::text, ' and no countdown'),
  'waiting and no countdown', 'its card goes back to waiting on the founder');
update public.profiles set cmo_paused_at = null where id = 'e2980000-0000-4000-8000-00000000000a';

-- Turning the switch off stops what was counting down.
select pg_temp.post('e2982000-0000-4000-8000-000000000006', 48);
select public.approval_raise('e2980000-0000-4000-8000-00000000000a', 'content_item', 'e2982000-0000-4000-8000-000000000006');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2980000-0000-4000-8000-00000000000a"}';
select public.save_autopilot('{}'::text[], 12::smallint);
reset role;
select is((select count(*)::int from public.approvals where user_id = 'e2980000-0000-4000-8000-00000000000a' and status in ('waiting', 'held') and auto_at is not null),
  0, 'off: no card counts down any more');

select * from finish();
rollback;
