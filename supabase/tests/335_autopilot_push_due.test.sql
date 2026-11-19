-- Review of #238, finding 3 (20270131020006): `autopilot_push_due` is the push's list of cards autopilot will really
-- approve. Its rule is `post_autopilot_still_on`, tested with autopilot; here: it runs, it reads the window, and
-- founders cannot call it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(4);

select ok(not has_function_privilege('authenticated', 'public.autopilot_push_due(timestamptz, timestamptz)', 'execute'),
  'founders cannot call it');
select lives_ok($$ select * from public.autopilot_push_due(now(), now() + interval '2 hours') $$, 'it runs');
select is((select count(*)::int from public.autopilot_push_due(now() + interval '3 hours', now() + interval '2 hours')), 0,
  'an empty window lists nothing');

select ok(has_function_privilege('authenticated', 'public.my_autopilot_due()', 'execute'), 'a founder reads their own list');

select * from finish();
rollback;
