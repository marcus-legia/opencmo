-- Draft outcomes (20261201100000): every post and opportunity decision writes one row in the same
-- transaction; approvals record how close the approved text is to the nearest drafted version.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(25);

insert into auth.users (id, email) values
  ('e1630000-0000-4000-8000-00000000000a', 'outcome-a@test.local'),
  ('e1630000-0000-4000-8000-00000000000b', 'outcome-b@test.local');

-- Four drafts for A: approved as written, approved after an edit to an alternate, skipped, and
-- one without provenance (drafted before `gen` existed).
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e1631000-0000-4000-8000-000000000001', 'e1630000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'As written', 'in_review',
   '{"text":"Late invoices are a process problem, not a people problem.","alternates":["Send reminders on day 3, 7 and 14.","Stop chasing clients by hand."],"gen":{"model":"claude-sonnet-5-5","prompt_version":"aaaaaaaaaaaa"}}'),
  ('e1631000-0000-4000-8000-000000000002', 'e1630000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'Edited', 'in_review',
   '{"text":"Late invoices are a process problem, not a people problem.","alternates":["Send reminders on day 3, 7 and 14 so nobody has to chase.","Stop chasing clients by hand."],"gen":{"model":"claude-sonnet-5-5","prompt_version":"aaaaaaaaaaaa"}}'),
  ('e1631000-0000-4000-8000-000000000003', 'e1630000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'Skipped', 'in_review',
   '{"text":"Our revolutionary invoicing app.","gen":{"model":"gemini-pro-latest","prompt_version":"bbbbbbbbbbbb"}}'),
  ('e1631000-0000-4000-8000-000000000004', 'e1630000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'Old draft', 'in_review',
   '{"text":"A post from before provenance."}');
insert into public.opportunities (id, user_id, url, title, score, reply, gen) values
  ('e1632000-0000-4000-8000-000000000001', 'e1630000-0000-4000-8000-00000000000a', 'https://www.reddit.com/r/freelance/comments/o1/a', 'Replied', 80, 'r',
   '{"model":"claude-sonnet-5-5","prompt_version":"cccccccccccc"}'),
  ('e1632000-0000-4000-8000-000000000002', 'e1630000-0000-4000-8000-00000000000a', 'https://www.reddit.com/r/freelance/comments/o2/b', 'Dismissed', 80, 'r', '{}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1630000-0000-4000-8000-00000000000a"}';

select throws_ok($$ insert into public.cmo_draft_outcomes (user_id, item_id, department, action)
    values ('e1630000-0000-4000-8000-00000000000a', gen_random_uuid(), 'post', 'approve') $$,
  '42501', null, 'users cannot write outcomes directly');

select lives_ok($$ select public.cmo_decide_post('e1631000-0000-4000-8000-000000000001', 'approve') $$, 'approve as written');
select lives_ok($$ select public.cmo_decide_post('e1631000-0000-4000-8000-000000000002', 'approve',
  'Send reminders on day 3, 7 and 14 so you never chase.') $$, 'approve an edited alternate');
select lives_ok($$ select public.cmo_decide_post('e1631000-0000-4000-8000-000000000003', 'skip', null, 'Too salesy') $$, 'skip');
select lives_ok($$ select public.cmo_decide_post('e1631000-0000-4000-8000-000000000004', 'approve') $$, 'approve a draft without provenance');
select lives_ok($$ select public.cmo_decide_opportunity('e1632000-0000-4000-8000-000000000001', 'replied') $$, 'reply');
select lives_ok($$ select public.cmo_decide_opportunity('e1632000-0000-4000-8000-000000000002', 'dismissed') $$, 'dismiss');

create temp table o as select * from public.cmo_draft_outcomes;
select is((select count(*) from o), 6::bigint, 'one outcome per decision');

select results_eq($$ select chosen_version::int, similarity, edit_mode, model, prompt_version from o
    where item_id = 'e1631000-0000-4000-8000-000000000001' $$,
  $$ values (0, 1::real, 'NO_MEANINGFUL_EDIT', 'claude-sonnet-5-5', 'aaaaaaaaaaaa') $$,
  'as written: version 0, similarity 1, labelled at once, provenance copied');
select ok((select classified_at is not null from o where item_id = 'e1631000-0000-4000-8000-000000000001'), 'as written needs no classifier');

select is((select chosen_version::int from o where item_id = 'e1631000-0000-4000-8000-000000000002'), 1, 'edited: nearest version is the first alternate');
select ok((select similarity > 0.3 and similarity < 0.95 from o where item_id = 'e1631000-0000-4000-8000-000000000002'), 'edited: similarity below as-written');
select ok((select edit_mode is null and classified_at is null from o where item_id = 'e1631000-0000-4000-8000-000000000002'), 'edited: waits for the classifier');

select results_eq($$ select action, chosen_version, similarity, model from o where item_id = 'e1631000-0000-4000-8000-000000000003' $$,
  $$ values ('skip', null::smallint, null::real, 'gemini-pro-latest') $$, 'skip: no similarity, model kept');
select results_eq($$ select similarity, model, prompt_version from o where item_id = 'e1631000-0000-4000-8000-000000000004' $$,
  $$ values (1::real, '', '') $$, 'no provenance: empty model and prompt');

select results_eq($$ select department, action, model from o where item_id = 'e1632000-0000-4000-8000-000000000001' $$,
  $$ values ('sales', 'replied', 'claude-sonnet-5-5') $$, 'replied opportunity');
select results_eq($$ select department, action, similarity from o where item_id = 'e1632000-0000-4000-8000-000000000002' $$,
  $$ values ('sales', 'dismissed', null::real) $$, 'dismissed opportunity');

select throws_ok($$ update public.cmo_draft_outcomes set edit_mode = 'TOO_LONG' $$, '42501', null, 'users cannot label outcomes');
select throws_ok($$ delete from public.cmo_draft_outcomes $$, '42501', null, 'users cannot delete outcomes');
select throws_ok($$ select * from public.cmo_draft_quality_weekly $$, '42501', null, 'the weekly view is not for users');

-- A failed decision writes nothing.
select throws_ok($$ select public.cmo_decide_post('e1631000-0000-4000-8000-000000000001', 'approve') $$,
  'P0001', 'This post was already decided.', 'deciding twice fails');
select is((select count(*) from public.cmo_draft_outcomes), 6::bigint, 'and adds no outcome');

set local request.jwt.claims = '{"sub":"e1630000-0000-4000-8000-00000000000b"}';
select is((select count(*) from public.cmo_draft_outcomes), 0::bigint, 'B cannot read A''s outcomes');

reset role;
set local role service_role;
select results_eq($$ select decided::int, approved_as_written::int, approved_edited::int, skipped::int from public.cmo_draft_quality_weekly
    where department = 'post' and model = 'claude-sonnet-5-5' $$,
  $$ values (2, 1, 1, 0) $$, 'weekly view splits by model');
select is((select edit_modes from public.cmo_draft_quality_weekly where department = 'post' and model = 'claude-sonnet-5-5'),
  '{"NO_MEANINGFUL_EDIT": 1}'::jsonb, 'weekly view counts labels');

select * from finish();
rollback;
