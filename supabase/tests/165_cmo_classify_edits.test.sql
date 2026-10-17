-- Edit classifier RPCs (20261201120000): only edited approvals are handed out, with the version the
-- founder started from; a label is written once; users can call neither.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(10);

insert into auth.users (id, email) values ('e1650000-0000-4000-8000-00000000000a', 'classify-a@test.local');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e1651000-0000-4000-8000-000000000001', 'e1650000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'Edited', 'in_review',
   '{"text":"Our revolutionary app changes invoicing forever.","alternates":["Late invoices are a process problem, not a people problem."]}'),
  ('e1651000-0000-4000-8000-000000000002', 'e1650000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'As written', 'in_review',
   '{"text":"Send reminders on day 3, 7 and 14."}'),
  ('e1651000-0000-4000-8000-000000000003', 'e1650000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'Skipped', 'in_review',
   '{"text":"Skip me."}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1650000-0000-4000-8000-00000000000a"}';
select public.cmo_decide_post('e1651000-0000-4000-8000-000000000001', 'approve', 'Late invoices are a process problem. Fix the process.');
select public.cmo_decide_post('e1651000-0000-4000-8000-000000000002', 'approve');
select public.cmo_decide_post('e1651000-0000-4000-8000-000000000003', 'skip');

select throws_ok($$ select * from public.cmo_unclassified_outcomes(10) $$, '42501', null, 'users cannot read the classifier queue');
select throws_ok($$ select public.cmo_set_edit_mode(gen_random_uuid(), 'TOO_LONG') $$, '42501', null, 'users cannot label');

reset role;
set local role service_role;
create temp table q as select * from public.cmo_unclassified_outcomes(10);
select is((select count(*) from q), 1::bigint, 'only the edited approval waits');
select results_eq($$ select draft, final_text from q $$,
  $$ values ('Late invoices are a process problem, not a people problem.', 'Late invoices are a process problem. Fix the process.') $$,
  'the draft is the version the founder started from');
select is((select count(*) from public.cmo_unclassified_outcomes(0)), 0::bigint, 'limit 0 returns nothing');

select throws_ok($$ select public.cmo_set_edit_mode((select id from q), 'MADE_UP') $$, '22023', 'Unknown edit mode.', 'unknown label');
select ok(public.cmo_set_edit_mode((select id from q), 'HOOK_REWRITTEN'), 'label written');
select ok(not public.cmo_set_edit_mode((select id from q), 'FULL_REWRITE'), 'a label is written once');
select is((select edit_mode from public.cmo_draft_outcomes where id = (select id from q)), 'HOOK_REWRITTEN', 'first label kept');
select is((select count(*) from public.cmo_unclassified_outcomes(10)), 0::bigint, 'nothing left to classify');

select * from finish();
rollback;
