-- cmo-review-3 2.3 (20270113040000): the voice as a page with history and Undo. Each source writes an event (a card,
-- the rating sheet, the Voice page, the strategy document); Undo restores what was there before, once per event, and
-- twice in a row reverts the one before; another founder's events are out of reach.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(16);

select ok(has_table_privilege('authenticated', 'public.cmo_voice_events', 'select'), 'founders read their history');
select ok(not has_table_privilege('authenticated', 'public.cmo_voice_events', 'insert'), 'and never write it');

insert into auth.users (id, email) values
  ('e2790000-0000-4000-8000-00000000000a', 'voice-a@test.local'),
  ('e2790000-0000-4000-8000-00000000000b', 'voice-b@test.local');
insert into public.cmo_corrections (id, user_id, rule, source, status) values
  ('e2791000-0000-4000-8000-00000000000a', 'e2790000-0000-4000-8000-00000000000a', 'Help first: drop the pitch and the hype.', 'edits', 'proposed');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body)
values ('e2793000-0000-4000-8000-00000000000a', 'e2790000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Rated', 'in_review', '{"text":"Buy now."}');
insert into public.cmo_draft_ratings (user_id, item_id, version, verdict, words, round)
values ('e2790000-0000-4000-8000-00000000000a', 'e2793000-0000-4000-8000-00000000000a', 0, 'down', 'Buy now.', 'e2792000-0000-4000-8000-00000000000a');
insert into public.cmo_corrections (id, user_id, rule, source, status, round_id) values
  ('e2791000-0000-4000-8000-00000000000b', 'e2790000-0000-4000-8000-00000000000a', 'Name one specific step.', 'ratings', 'proposed', 'e2792000-0000-4000-8000-00000000000a');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2790000-0000-4000-8000-00000000000a","role":"authenticated"}';
-- Onboarding's strategy (as the CMO writes it), then the founder's own edit of the voice.
select public.save_marketing_document('strategy', '{"voice":"Plain and direct.","avoid":["hype"]}');
reset role;
update public.marketing_documents set created_by = 'agent' where user_id = 'e2790000-0000-4000-8000-00000000000a';
update public.cmo_voice_events set source = 'setup' where user_id = 'e2790000-0000-4000-8000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2790000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.save_marketing_document('strategy', '{"voice":"Plain, direct, a little dry.","avoid":["hype"]}');
-- A card, the rating sheet and the page.
select public.cmo_decide_correction('e2791000-0000-4000-8000-00000000000a', 'approve');
select public.cmo_accept_corrections('e2792000-0000-4000-8000-00000000000a', array['e2791000-0000-4000-8000-00000000000b'::uuid], array['Name one specific step, like a day.']);
select public.cmo_edit_correction('e2791000-0000-4000-8000-00000000000a', 'Help first: no pitch, no hype.');
reset role;

select is((select string_agg(coalesce(field, 'rule') || ':' || source, ', ' order by seq) from public.cmo_voice_events
  where user_id = 'e2790000-0000-4000-8000-00000000000a'),
  'voice:setup, avoid:setup, voice:you, rule:edits, rule:ratings, rule:you', 'each source writes its event');
select is((select before #>> '{}' from public.cmo_voice_events where user_id = 'e2790000-0000-4000-8000-00000000000a' and source = 'you' and field = 'voice'),
  'Plain and direct.', 'the strategy event keeps the words before');

-- Another founder: nothing of A's to undo.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2790000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok($$ select public.cmo_voice_undo() $$, 'P0002', 'There is nothing to undo.', 'another founder''s events are out of reach');
select throws_ok($$ select public.cmo_edit_correction('e2791000-0000-4000-8000-00000000000a', 'Mine now.') $$, 'P0002', 'Rule not found.', 'and their rules');
select is((select count(*)::int from public.cmo_voice_events), 0, 'they see no history but their own');

-- Undo: the edit on the page, then the rating rule's acceptance.
set local request.jwt.claims = '{"sub":"e2790000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.cmo_voice_undo();
reset role;
select is((select rule || ':' || status from public.cmo_corrections where id = 'e2791000-0000-4000-8000-00000000000a'),
  'Help first: drop the pitch and the hype.:active', 'undo restores the words before');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2790000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.cmo_voice_undo();
reset role;
select is((select status from public.cmo_corrections where id = 'e2791000-0000-4000-8000-00000000000b'), 'rejected',
  'twice in a row reverts the one before: the rating rule is off again');
select is((select count(*)::int from public.cmo_voice_events where user_id = 'e2790000-0000-4000-8000-00000000000a' and undone_at is not null), 2,
  'each undo marks its own event');
select is((select count(*)::int from public.cmo_voice_events where user_id = 'e2790000-0000-4000-8000-00000000000a'), 6, 'undo writes no event of its own');

-- Turning a rule off on the page is an event; undoing it turns it back on.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2790000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.cmo_edit_correction('e2791000-0000-4000-8000-00000000000a', null, false);
reset role;
select is((select status from public.cmo_corrections where id = 'e2791000-0000-4000-8000-00000000000a'), 'rejected', 'turned off');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2790000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.cmo_voice_undo();
reset role;
select is((select status from public.cmo_corrections where id = 'e2791000-0000-4000-8000-00000000000a'), 'active', 'undo turns it back on');

-- Undo of the founder's strategy edit: the voice goes back, as a new version, and writes no event.
update public.cmo_voice_events set undone_at = now()
where user_id = 'e2790000-0000-4000-8000-00000000000a' and correction_id is not null and undone_at is null;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2790000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.cmo_voice_undo();
reset role;
select is((select body->>'voice' from public.marketing_documents where user_id = 'e2790000-0000-4000-8000-00000000000a' and kind = 'strategy'
  order by version desc limit 1), 'Plain and direct.', 'the strategy''s voice is back');
select is((select count(*)::int from public.marketing_documents where user_id = 'e2790000-0000-4000-8000-00000000000a' and kind = 'strategy'), 3,
  'as a new version');
select is((select count(*)::int from public.cmo_voice_events where user_id = 'e2790000-0000-4000-8000-00000000000a'), 7, 'with no event for the undo');

select * from finish();
rollback;
