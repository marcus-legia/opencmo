-- 20270123010000: the top bar's switch turns autopilot off without forgetting the founder's platforms; off, every
-- countdown stops and nothing new counts down. Also the two cases 298 left out: three skips in a row turn a platform
-- off, and an automatic approval past the day's cap leaves the card waiting.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(20);

select ok(has_function_privilege('authenticated', 'public.set_autopilot_paused(boolean)', 'execute'), 'a founder can flip their own switch');
select ok(not has_function_privilege('anon', 'public.set_autopilot_paused(boolean)', 'execute'), 'anon cannot');

insert into auth.users (id, email) values
  ('e3150000-0000-4000-8000-00000000000a', 'switch@test.local'),
  ('e3150000-0000-4000-8000-00000000000b', 'switch-free@test.local');
insert into public.profiles (id, email) values
  ('e3150000-0000-4000-8000-00000000000a', 'switch@test.local'),
  ('e3150000-0000-4000-8000-00000000000b', 'switch-free@test.local')
on conflict (id) do nothing;
update public.profiles set plan = 'starter', timezone = 'UTC', autopilot_platforms = array['x'], autopilot_hours = 12
where id = 'e3150000-0000-4000-8000-00000000000a';
insert into public.social_accounts (id, user_id, platform, handle, zernio_account_id) values
  ('e3151000-0000-4000-8000-000000000001', 'e3150000-0000-4000-8000-00000000000a', 'x', 'founder', 'z-x-315');
delete from public.approvals where user_id = 'e3150000-0000-4000-8000-00000000000a';

-- A post in review with a time two days out and the connected account, raised as a card.
create function pg_temp.raise(p_n integer) returns public.approvals language plpgsql as $$
declare
  v_id uuid := ('e3152000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
  v_card public.approvals;
begin
  insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
  values (v_id, 'e3150000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Post ' || p_n, 'in_review',
    jsonb_build_object('text', 'One true thing, number ' || p_n || '.', 'proposed', jsonb_build_object(
      'platform', 'x', 'mode', 'publish', 'account_id', 'e3151000-0000-4000-8000-000000000001', 'handle', 'founder',
      'at', to_char(date_trunc('minute', now() + interval '2 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
  perform public.approval_raise('e3150000-0000-4000-8000-00000000000a', 'content_item', v_id);
  select * into v_card from public.approvals where ref_id = v_id and ref_kind = 'content_item' order by created_at desc limit 1;
  return v_card;
end $$;
create function pg_temp.card(p_n integer) returns public.approvals language sql as $$
  select * from public.approvals where ref_kind = 'content_item'
    and ref_id = ('e3152000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
  order by created_at desc limit 1;
$$;

select isnt((pg_temp.raise(1)).auto_at, null, 'on: a new post counts down');

-- Off from the top bar.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3150000-0000-4000-8000-00000000000a"}';
select is((select autopilot_paused from public.set_autopilot_paused(true)), true, 'the founder turns autopilot off');
reset role;
select is((pg_temp.card(1)).auto_at, null, 'off: the post counting down waits for Approve');
select is((select autopilot_platforms from public.profiles where id = 'e3150000-0000-4000-8000-00000000000a'), array['x'],
  'the founder''s platforms are kept');
select is((pg_temp.raise(2)).auto_at, null, 'off: a new post does not count down');

-- A countdown set before the switch (a card raised in the same instant) is not approved while it is off.
update public.approvals set auto_at = now() - interval '1 minute' where id = (pg_temp.card(2)).id;
select is(public.approval_auto_decide(), 0, 'off: the cron approves nothing');
select is((pg_temp.card(2)).status || coalesce((pg_temp.card(2)).auto_at::text, ' and no countdown'), 'waiting and no countdown',
  'that card waits for the founder');

-- On again.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3150000-0000-4000-8000-00000000000a"}';
select is((select autopilot_paused from public.set_autopilot_paused(false)), false, 'the founder turns autopilot back on');
reset role;
select isnt((pg_temp.raise(3)).auto_at, null, 'on again: the next post counts down');
select is((pg_temp.card(1)).auto_at, null, 'a card that lost its countdown keeps waiting for the founder');

-- Anyone signed in may turn it off, whatever their plan; it says what it needs.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3150000-0000-4000-8000-00000000000b"}';
select lives_ok($$ select public.set_autopilot_paused(true) $$, 'a free account can turn it off');
select throws_ok($$ select public.set_autopilot_paused(null) $$, '22023', 'Say whether autopilot is on or off.', 'on or off, not nothing');
reset role;

-- Three autopilot posts skipped in a row turn it off for X, with a note, and stop what still counts down.
select pg_temp.raise(4); select pg_temp.raise(5); select pg_temp.raise(6);
update public.approvals set status = 'skipped', decided_at = now() - interval '3 minutes' where id = (pg_temp.card(4)).id;
update public.approvals set status = 'skipped', decided_at = now() - interval '2 minutes' where id = (pg_temp.card(5)).id;
select is((select autopilot_platforms from public.profiles where id = 'e3150000-0000-4000-8000-00000000000a'), array['x'],
  'two skips change nothing');
update public.approvals set status = 'skipped', decided_at = now() - interval '1 minute' where id = (pg_temp.card(6)).id;
select is((select autopilot_platforms from public.profiles where id = 'e3150000-0000-4000-8000-00000000000a'), '{}'::text[],
  'the third skip in a row turns X off');
select is((select autopilot_note from public.profiles where id = 'e3150000-0000-4000-8000-00000000000a'),
  'Turned off for X after you skipped three posts in a row.', 'and says why');
select is((pg_temp.card(3)).auto_at, null, 'the post still counting down waits for the founder');

-- The day's cap (five approvals a platform) holds for an automatic approval too: the card goes back to waiting.
update public.profiles set autopilot_platforms = array['x'], autopilot_note = null where id = 'e3150000-0000-4000-8000-00000000000a';
insert into public.operation_log (user_id, platform, action, target)
select 'e3150000-0000-4000-8000-00000000000a', 'x', 'approve', 'seed-' || g from generate_series(1, 5) g;
select pg_temp.raise(7);
update public.approvals set auto_at = now() - interval '1 minute' where id = (pg_temp.card(7)).id;
select is(public.approval_auto_decide(), 0, 'past the day''s cap nothing is approved');
select is((pg_temp.card(7)).status || coalesce((pg_temp.card(7)).auto_at::text, ' and no countdown'), 'waiting and no countdown',
  'the card waits for the founder');

select * from finish();
rollback;
