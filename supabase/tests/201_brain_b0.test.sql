-- Brain B0 (20261227090000): corrections are proposed by the brain, decided once by their owner, retired with
-- reject; settings save within bounds and only a known time zone.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(26);

insert into auth.users (id, email) values
  ('e2010000-0000-4000-8000-00000000000a', 'b0@test.local'),
  ('e2010000-0000-4000-8000-00000000000b', 'b0-other@test.local');

-- Grants and RLS.
select ok(has_table_privilege('authenticated', 'public.cmo_corrections', 'select'), 'founders read corrections');
select ok(not has_table_privilege('authenticated', 'public.cmo_corrections', 'insert'), 'founders cannot insert corrections');
select ok(not has_table_privilege('authenticated', 'public.cmo_corrections', 'update'), 'founders cannot update corrections');
select ok(not has_table_privilege('anon', 'public.cmo_corrections', 'select'), 'anon reads nothing');
select ok(has_table_privilege('service_role', 'public.cmo_corrections', 'insert'), 'the service role writes corrections');
select ok(not has_function_privilege('authenticated', 'public.cmo_propose_correction(uuid,text,jsonb)', 'execute'), 'only the brain proposes');

-- Proposing.
create temp table t_c (name text primary key, id uuid) on commit drop;
grant all on t_c to authenticated;
insert into t_c select 'a', (public.cmo_propose_correction('e2010000-0000-4000-8000-00000000000a', ' Don''t open posts with a question. ',
  '[{"before":"Tired of editing demos?","after":"Editing a demo should not take longer than building it."}]')).id;
select is((select rule from public.cmo_corrections where id = (select id from t_c where name = 'a')), 'Don''t open posts with a question.', 'the rule is trimmed');
select is((public.cmo_propose_correction('e2010000-0000-4000-8000-00000000000a', 'don''t open posts with a question.')).id,
  (select id from t_c where name = 'a'), 'the same rule twice is one row');
select throws_ok($$ select public.cmo_propose_correction('e2010000-0000-4000-8000-00000000000a', 'no') $$, '22023',
  'Write the rule in 3 to 200 characters.', 'a rule needs 3 to 200 characters');
insert into t_c select 'b', (public.cmo_propose_correction('e2010000-0000-4000-8000-00000000000a', 'No links in posts.')).id;
insert into t_c select 'c', (public.cmo_propose_correction('e2010000-0000-4000-8000-00000000000a', 'Short sentences.')).id;
select public.cmo_propose_correction('e2010000-0000-4000-8000-00000000000a', 'Rule four.');
select public.cmo_propose_correction('e2010000-0000-4000-8000-00000000000a', 'Rule five.');
select throws_ok($$ select public.cmo_propose_correction('e2010000-0000-4000-8000-00000000000a', 'Rule six.') $$, 'P0001',
  'Five rules already wait for a decision.', 'at most five proposals wait');

-- Deciding, as the owner.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2010000-0000-4000-8000-00000000000a"}';
select is((select count(*)::int from public.cmo_corrections), 5, 'the owner reads their rules');
select is((public.cmo_decide_correction((select id from t_c where name = 'a'), 'approve')).status, 'active', 'approve makes it a rule');
select throws_ok(format($$ select public.cmo_decide_correction(%L, 'approve') $$, (select id from t_c where name = 'a')), 'P0001',
  'This rule was already decided.', 'an active rule cannot be approved again');
select is((public.cmo_decide_correction((select id from t_c where name = 'b'), 'edit', '  No links in posts or replies. ')).rule,
  'No links in posts or replies.', 'edit keeps the founder''s wording');
select is((select status from public.cmo_corrections where id = (select id from t_c where name = 'b')), 'active', 'an edited rule is active');
select throws_ok(format($$ select public.cmo_decide_correction(%L, 'edit', 'x') $$, (select id from t_c where name = 'c')), '22023',
  'Write the rule in 3 to 200 characters.', 'edit needs a rule');
select is((public.cmo_decide_correction((select id from t_c where name = 'c'), 'reject')).status, 'rejected', 'reject a proposal');
select throws_ok(format($$ select public.cmo_decide_correction(%L, 'approve') $$, (select id from t_c where name = 'c')), 'P0001',
  'This rule was already decided.', 'a rejected rule stays rejected');
select is((public.cmo_decide_correction((select id from t_c where name = 'a'), 'reject')).status, 'rejected', 'the founder retires an active rule');
select throws_ok(format($$ select public.cmo_decide_correction(%L, 'keep') $$, (select id from t_c where name = 'b')), '22023',
  'Choose approve, edit or reject.', 'unknown action');

-- Someone else's rule.
set local request.jwt.claims = '{"sub":"e2010000-0000-4000-8000-00000000000b"}';
select is((select count(*)::int from public.cmo_corrections), 0, 'another founder reads none of them');
select throws_ok(format($$ select public.cmo_decide_correction(%L, 'approve') $$, (select id from t_c where name = 'b')), 'P0002',
  'Rule not found.', 'another founder cannot decide them');

-- Settings.
set local request.jwt.claims = '{"sub":"e2010000-0000-4000-8000-00000000000a"}';
select results_eq($$ select * from public.save_cmo_settings(120, 'Asia/Ho_Chi_Minh', 7::smallint) $$,
  $$ values (120, 'Asia/Ho_Chi_Minh'::text, 7::smallint) $$, 'settings save');
select throws_ok($$ select public.save_cmo_settings(10001, 'UTC', 7::smallint) $$, '22023',
  'The weekly budget must be between 0 and 10,000 credits.', 'budget has an upper bound');
select throws_ok($$ select public.save_cmo_settings(-1, 'UTC', 7::smallint) $$, '22023',
  'The weekly budget must be between 0 and 10,000 credits.', 'budget cannot be negative');
select throws_ok($$ select public.save_cmo_settings(80, 'Mars/Olympus', 7::smallint) $$, '22023',
  'Choose a time zone from the list.', 'an unknown time zone is refused');

select * from finish();
rollback;
