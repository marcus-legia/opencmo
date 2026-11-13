-- 20270120025000: a Threads post over 500 characters is a chain, and a chain never goes out on autopilot; a long X
-- post still does. A slot on X takes the founder's "post as a thread" setting; no other platform does.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(13);

select ok(not has_function_privilege('authenticated', 'public.post_is_threads_chain(uuid,jsonb)', 'execute'), 'a founder cannot call the helper');
select ok(not has_function_privilege('anon', 'public.post_is_threads_chain(uuid,jsonb)', 'execute'), 'anon cannot');

insert into auth.users (id, email) values ('e3010000-0000-4000-8000-00000000000a', 'chain@test.local');
insert into public.profiles (id, email) values ('e3010000-0000-4000-8000-00000000000a', 'chain@test.local') on conflict (id) do nothing;
update public.profiles set plan = 'starter', timezone = 'UTC' where id = 'e3010000-0000-4000-8000-00000000000a';

insert into public.social_accounts (id, user_id, platform, handle, zernio_account_id) values
  ('e3011000-0000-4000-8000-000000000001', 'e3010000-0000-4000-8000-00000000000a', 'x', 'founder', 'z-x-301'),
  ('e3011000-0000-4000-8000-000000000002', 'e3010000-0000-4000-8000-00000000000a', 'threads', 'founder', 'z-th-301');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3010000-0000-4000-8000-00000000000a"}';
select lives_ok($$ select public.save_autopilot(array['x', 'threads'], 12::smallint) $$, 'autopilot on for X and Threads');
reset role;

-- A post in review two days out, on its connected account, with a text of the given length.
create function pg_temp.post(p_id uuid, p_platform text, p_chars integer, p_extra jsonb default '{}') returns uuid language plpgsql as $$
begin
  insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
  values (p_id, 'e3010000-0000-4000-8000-00000000000a', 'post', case p_platform when 'x' then 'X' else 'Threads' end,
    current_date, 'A post', 'in_review',
    jsonb_build_object('text', rpad('', p_chars, 'One true thing. '), 'proposed', jsonb_build_object(
      'platform', p_platform, 'mode', 'publish', 'handle', 'founder',
      'account_id', case p_platform when 'x' then 'e3011000-0000-4000-8000-000000000001' else 'e3011000-0000-4000-8000-000000000002' end,
      'at', to_char(date_trunc('minute', now() + interval '48 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) || p_extra);
  delete from public.approvals where ref_id = p_id;
  perform public.approval_raise('e3010000-0000-4000-8000-00000000000a', 'content_item', p_id);
  return p_id;
end;
$$;
create function pg_temp.auto_at(p_item uuid) returns timestamptz language sql as $$
  select auto_at from public.approvals where ref_id = p_item and ref_kind = 'content_item' and status in ('waiting', 'held') order by created_at desc limit 1;
$$;

select isnt(pg_temp.auto_at(pg_temp.post('e3012000-0000-4000-8000-000000000001', 'threads', 300)), null, 'a Threads post of 300 characters goes out on its own');
select isnt(pg_temp.auto_at(pg_temp.post('e3012000-0000-4000-8000-000000000002', 'threads', 500)), null, 'so does one of exactly 500');
select is(pg_temp.auto_at(pg_temp.post('e3012000-0000-4000-8000-000000000003', 'threads', 600)), null, 'a Threads post of 600 characters is a chain: it waits for the founder');
select is((select status from public.approvals where ref_id = 'e3012000-0000-4000-8000-000000000003' order by created_at desc limit 1),
  'waiting', 'the chain still has its ordinary card');
select isnt(pg_temp.auto_at(pg_temp.post('e3012000-0000-4000-8000-000000000004', 'x', 2000)), null, 'an X post of 2,000 characters goes out on its own');
-- One core post for X and Threads (the planner's targets): approving it also schedules the Threads chain.
select is(pg_temp.auto_at(pg_temp.post('e3012000-0000-4000-8000-000000000005', 'x', 600, '{"targets":["x","threads"]}')), null,
  'a long post that also goes to Threads waits for the founder');
-- The day's card budget holds this sixth card, and a held card counts down only once the founder can see it
-- (20270121020000): show it first.
select pg_temp.post('e3012000-0000-4000-8000-000000000006', 'x', 600, '{"targets":["x","linkedin"]}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3010000-0000-4000-8000-00000000000a"}';
select public.approval_show_now('content_item', 'e3012000-0000-4000-8000-000000000006');
reset role;
select isnt(pg_temp.auto_at('e3012000-0000-4000-8000-000000000006'), null,
  'a long post that does not go to Threads is not held back');

-- The thread setting of a slot: X only, on or off.
select is(public.schedule_options_merge('x', '{"ai_label": false}', '{"as_thread": true}'), '{"ai_label": false, "as_thread": true}'::jsonb,
  'an X slot takes "post as a thread"');
select throws_ok($$ select public.schedule_options_merge('threads', '{}', '{"as_thread": true}') $$, '22023', 'Posting as a thread is only for X.',
  'no other platform takes it');
select throws_ok($$ select public.schedule_options_merge('x', '{}', '{"as_thread": "yes"}') $$, '22023', 'A platform toggle is on or off.',
  'it is on or off');

select * from finish();
rollback;
