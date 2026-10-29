-- P3 A1 (20261229100000): voice notes from approvals as written, named edits and skip reasons; weight by age, expiry,
-- the founder's delete; a correction card from the same edit three times in 14 days, one at a time; posts decided
-- against their own platform's limit; calendar labels resolve to profiles.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(55);

-- Who may call what.
select ok(has_function_privilege('authenticated', 'public.voice_note_add(uuid)', 'execute'), 'the founder adds a note from a decision');
select ok(has_function_privilege('authenticated', 'public.voice_note_delete(uuid)', 'execute'), 'and deletes one');
select ok(has_function_privilege('authenticated', 'public.voice_notes(integer,text)', 'execute'), 'and reads theirs');
select ok(not has_function_privilege('authenticated', 'public.voice_notes_for(uuid,integer,text)', 'execute'), 'another founder''s notes are the service role''s only');
select ok(has_function_privilege('service_role', 'public.voice_notes_for(uuid,integer,text)', 'execute'), 'Writer reads them as the service role');
select ok(not has_function_privilege('authenticated', 'public.voice_note_write(uuid,text)', 'execute'), 'the writer of notes is internal');
select ok(not has_function_privilege('authenticated', 'public.correction_from_edits(uuid)', 'execute'), 'and so is the rule check');

-- Labels resolve to profiles.
select is(public.platform_profile_id('X'), 'x', 'the plan''s X');
select is(public.platform_profile_id('LinkedIn'), 'linkedin', 'LinkedIn');
select is(public.platform_profile_id('Reels'), 'instagram_caption', 'Reels are an Instagram caption');
select is(public.platform_profile_id('Reddit'), null, 'Reddit has no profile');

insert into auth.users (id, email) values
  ('e2110000-0000-4000-8000-00000000000a', 'voice@test.local'),
  ('e2110000-0000-4000-8000-00000000000b', 'voice-other@test.local');
insert into public.credit_ledger (user_id, delta, reason, ref_kind, ref_id)
select 'e2110000-0000-4000-8000-00000000000a', 0, 'noop', 'job', gen_random_uuid() where false;
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2111000-0000-4000-8000-000000000001', 'e2110000-0000-4000-8000-00000000000a', 'post', 'LinkedIn', current_date, 'Threads drafts',
    'in_review', '{"text":"We shipped Threads drafts today.","alternates":["Threads drafts are live."]}'),
  ('e2111000-0000-4000-8000-000000000002', 'e2110000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Cut by words',
    'in_review', '{"text":"Our new editor cuts video by words and it is honestly the best thing we have ever shipped for founders."}'),
  ('e2111000-0000-4000-8000-000000000003', 'e2110000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Pricing',
    'in_review', '{"text":"Our pricing is the best deal on the market."}'),
  ('e2111000-0000-4000-8000-000000000004', 'e2110000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Roadmap',
    'in_review', '{"text":"Here is our roadmap."}'),
  ('e2111000-0000-4000-8000-000000000005', 'e2110000-0000-4000-8000-00000000000a', 'post', 'LinkedIn', current_date, 'Long',
    'in_review', '{"text":"Long post."}'),
  ('e2111000-0000-4000-8000-000000000011', 'e2110000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Edit one',
    'in_review', '{"text":"Editing a demo used to take me a whole afternoon, so I built a tool that does it in minutes instead."}'),
  ('e2111000-0000-4000-8000-000000000012', 'e2110000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Edit two',
    'in_review', '{"text":"B-roll should land on the exact word you mean, and with a slash command it finally does that for you."}'),
  ('e2111000-0000-4000-8000-000000000013', 'e2110000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Edit three',
    'in_review', '{"text":"Captions that follow your brand kit, generated shots on the right words, and an export in one click."}'),
  ('e2111000-0000-4000-8000-000000000014', 'e2110000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Edit four',
    'in_review', '{"text":"Founders keep asking how the CMO plans a week, so here is the whole loop from goal to approved post."}');

create temp table t (name text primary key, id uuid) on commit drop;
grant all on t to authenticated, service_role;
create function pg_temp.outcome(p_item text) returns uuid language sql as $$
  select id from public.cmo_draft_outcomes where item_id = ('e2111000-0000-4000-8000-0000000000' || p_item)::uuid $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2110000-0000-4000-8000-00000000000a","role":"authenticated"}';

-- A LinkedIn post approved as written: its own platform, its own limit, a voice note at once.
select lives_ok($$ select public.cmo_decide_post('e2111000-0000-4000-8000-000000000001', 'approve') $$, 'approve on LinkedIn as written');
select throws_ok($$ select public.cmo_decide_post('e2111000-0000-4000-8000-000000000005', 'approve', repeat('a', 3001)) $$,
  '22023', 'Posts on LinkedIn can be at most 3,000 characters.', 'LinkedIn has its own limit');
select lives_ok($$ select public.cmo_decide_post('e2111000-0000-4000-8000-000000000005', 'approve', repeat('a', 2000)) $$,
  'a long LinkedIn post is fine');
reset role;
select is((select platform from public.cmo_draft_outcomes where id = pg_temp.outcome('01')), 'linkedin', 'the decision is LinkedIn''s');
select is((select count(*)::int from public.operation_log where user_id = 'e2110000-0000-4000-8000-00000000000a' and platform = 'linkedin'), 2,
  'LinkedIn approvals count against LinkedIn''s own cap');
select is((select body from public.cmo_memories where source_outcome = pg_temp.outcome('01')),
  'Approved as written on LinkedIn: "We shipped Threads drafts today."', 'an approval as written teaches its words');
select is((select type || ' ' || kind || ' ' || topic || ' ' || importance from public.cmo_memories where source_outcome = pg_temp.outcome('01')),
  'agent preference post 1', 'a voice note is a post preference, below the founder''s own notes');
select ok((select expires_at between now() + interval '59 days' and now() + interval '61 days'
  from public.cmo_memories where source_outcome = pg_temp.outcome('01')), 'it expires after 60 days');

-- An edit teaches nothing until the classifier names it; then the note carries the final words.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2110000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.cmo_decide_post('e2111000-0000-4000-8000-000000000002', 'approve', 'We shipped cut by words.') $$, 'approve an edit on X');
reset role;
select is((select platform from public.cmo_draft_outcomes where id = pg_temp.outcome('02')), 'x', 'the label X is the x profile');
select is((select count(*)::int from public.cmo_memories where source_outcome = pg_temp.outcome('02')), 0, 'no note before the edit is named');
select ok(public.cmo_set_edit_mode(pg_temp.outcome('02'), 'TOO_LONG'), 'the classifier names the edit');
select is((select body from public.cmo_memories where source_outcome = pg_temp.outcome('02')),
  'Edited on X before approving (cut it shorter): "We shipped cut by words."', 'then the note says what changed and what stayed');

-- Skips: a reason is a note (and still a skip memory); no reason, nothing to learn.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2110000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.cmo_decide_post('e2111000-0000-4000-8000-000000000003', 'skip', null, 'Too salesy') $$, 'skip with a reason');
select lives_ok($$ select public.cmo_decide_post('e2111000-0000-4000-8000-000000000004', 'skip') $$, 'skip without one');
reset role;
select is((select body from public.cmo_memories where source_outcome = pg_temp.outcome('03')),
  'Skipped a draft on X about "Pricing": Too salesy', 'the reason is the note');
select is((select topic from public.cmo_memories where type = 'feedback' and body = 'Skipped the X post "Pricing": Too salesy'), 'post',
  'the skip memory stays, under Post');
select is((select count(*)::int from public.cmo_memories where source_outcome = pg_temp.outcome('04')), 0, 'a bare skip teaches nothing');

-- Reading: newest first, weighed by age; expired notes are gone.
-- One transaction has one now(): stagger the notes as days would.
update public.cmo_memories set created_at = now() - interval '30 days', expires_at = now() + interval '30 days'
where source_outcome = pg_temp.outcome('01');
update public.cmo_memories set created_at = now() - interval '1 hour', expires_at = now() - interval '1 hour' + interval '60 days'
where source_outcome = pg_temp.outcome('02');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2110000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((select array_agg(source order by created_at desc) from public.voice_notes()), array['skipped', 'edited', 'approved'],
  'newest first, each with what it came from');
select is((select round(weight::numeric, 2) from public.voice_notes() where source = 'approved'), 0.50, 'half its weight at half its life');
select is((select round(weight::numeric, 1) from public.voice_notes() where source = 'skipped'), 1.0, 'a new note weighs fully');
select is((select edit_mode from public.voice_notes() where source = 'edited'), 'TOO_LONG', 'an edit names its mode');
select is((select count(*)::int from public.voice_notes(20, 'linkedin')), 1, 'one platform''s notes');
reset role;
update public.cmo_memories set expires_at = now() - interval '1 minute' where source_outcome = pg_temp.outcome('03');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2110000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((select count(*)::int from public.voice_notes()), 2, 'an expired note is not read');

-- The RPC: idempotent for the owner, refused for anyone else.
select is((public.voice_note_add(pg_temp.outcome('02'))).id, (select id from public.cmo_memories where source_outcome = pg_temp.outcome('02')),
  'adding again returns the same note');
select is((public.voice_note_add(pg_temp.outcome('04'))).id, null, 'a decision with nothing to teach adds nothing');
set local request.jwt.claims = '{"sub":"e2110000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok($$ select public.voice_note_add(pg_temp.outcome('02')) $$, 'P0002', 'Decision not found.', 'not another founder''s decision');
select is((select count(*)::int from public.voice_notes()), 0, 'another founder reads none');
select throws_ok($$ select public.voice_note_delete((select id from public.cmo_memories where source_outcome = pg_temp.outcome('02'))) $$,
  'P0002', 'Voice note not found.', 'nor deletes one');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((public.voice_note_add(pg_temp.outcome('02'))).id, (select id from public.cmo_memories where source_outcome = pg_temp.outcome('02')),
  'the classifier''s service role may add');
select is((select count(*)::int from public.voice_notes_for('e2110000-0000-4000-8000-00000000000a')), 2, 'Writer reads the founder''s notes');
reset role;

-- The founder deletes a note: gone, and never written again.
insert into t select 'note', id from public.cmo_memories where source_outcome = pg_temp.outcome('02');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2110000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.voice_note_delete((select id from t where name = 'note')) $$, 'the founder deletes a note');
select is((select count(*)::int from public.voice_notes() where source = 'edited'), 0, 'it is gone');
select is((public.voice_note_add(pg_temp.outcome('02'))).id, null, 'and is not written again');
reset role;

-- Corrections: an old edit does not count; the third TOO_LONG in 14 days raises one card; a fourth adds none.
insert into public.cmo_draft_outcomes (user_id, item_id, department, action, chosen_version, similarity, edit_mode, decided_at)
values ('e2110000-0000-4000-8000-00000000000a', gen_random_uuid(), 'post', 'approve', 0, 0.3, 'TOO_LONG', now() - interval '20 days');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2110000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.cmo_decide_post('e2111000-0000-4000-8000-000000000011', 'approve', 'Editing a demo took an afternoon. Now minutes.');
select public.cmo_decide_post('e2111000-0000-4000-8000-000000000012', 'approve', 'B-roll lands on the word you mean.');
select public.cmo_decide_post('e2111000-0000-4000-8000-000000000013', 'approve', 'Captions, shots, export.');
select public.cmo_decide_post('e2111000-0000-4000-8000-000000000014', 'approve', 'Here is how the CMO plans a week.');
reset role;
update public.cmo_draft_outcomes set decided_at = now() - interval '3 hours' where id = pg_temp.outcome('11');
update public.cmo_draft_outcomes set decided_at = now() - interval '2 hours' where id = pg_temp.outcome('12');
update public.cmo_draft_outcomes set decided_at = now() - interval '1 hour' where id = pg_temp.outcome('13');
select public.cmo_set_edit_mode(pg_temp.outcome('11'), 'CTA_REMOVED');
select public.cmo_set_edit_mode(pg_temp.outcome('12'), 'CTA_REMOVED');
select is((select count(*)::int from public.cmo_corrections where user_id = 'e2110000-0000-4000-8000-00000000000a'), 0,
  'two edits are not a pattern');
select public.cmo_set_edit_mode(pg_temp.outcome('13'), 'CTA_REMOVED');
select is((select rule || ' · ' || edit_mode || ' · ' || times || ' · ' || status from public.cmo_corrections
  where user_id = 'e2110000-0000-4000-8000-00000000000a'),
  'End on the point itself: no closing ask, no summary line. · CTA_REMOVED · 3 · proposed', 'the third raises the rule');
select is((select jsonb_array_length(source_edits) from public.cmo_corrections where user_id = 'e2110000-0000-4000-8000-00000000000a'), 3,
  'with the three edits it came from');
select is((select source_edits->0->>'after' from public.cmo_corrections where user_id = 'e2110000-0000-4000-8000-00000000000a'),
  'Captions, shots, export.', 'newest first, draft and final');
select is((select snapshot->>'edit_mode' || ' ' || (snapshot->>'times') from public.approvals
  where kind = 'correction' and status = 'waiting' and user_id = 'e2110000-0000-4000-8000-00000000000a'), 'CTA_REMOVED 3',
  'its card names the edit and how often');
select public.cmo_set_edit_mode(pg_temp.outcome('14'), 'CTA_REMOVED');
select is((select count(*)::int from public.cmo_corrections where user_id = 'e2110000-0000-4000-8000-00000000000a'), 1,
  'no second card while one waits');
select is((select count(*)::int from public.cmo_corrections c where c.user_id = 'e2110000-0000-4000-8000-00000000000a'
  and c.edit_mode = 'TOO_LONG'), 0, 'an edit from three weeks ago and one this week are not a pattern');

-- A rule from skip reasons (no edit) keeps its old card shape.
select public.cmo_propose_correction('e2110000-0000-4000-8000-00000000000b', 'Do not post on weekends.');
select is((select snapshot ? 'edit_mode' from public.approvals where user_id = 'e2110000-0000-4000-8000-00000000000b' and kind = 'correction'),
  false, 'a rule not learned from an edit has no edit on its card');

-- Old outcomes left without a platform by A0 are filled.
alter table public.cmo_draft_outcomes disable trigger cmo_draft_outcomes_platform;
alter table public.cmo_draft_outcomes disable trigger cmo_draft_outcomes_learn;
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2111000-0000-4000-8000-000000000021', 'e2110000-0000-4000-8000-00000000000b', 'post', 'X', current_date, 'Old', 'approved', '{"text":"Old."}');
insert into public.cmo_draft_outcomes (user_id, item_id, department, action)
values ('e2110000-0000-4000-8000-00000000000b', 'e2111000-0000-4000-8000-000000000021', 'post', 'approve');
alter table public.cmo_draft_outcomes enable trigger cmo_draft_outcomes_platform;
alter table public.cmo_draft_outcomes enable trigger cmo_draft_outcomes_learn;
select is(public.cmo_draft_outcomes_backfill_platform(), 1, 'the backfill fills an outcome planned as "X"');
select is(public.cmo_draft_outcomes_backfill_platform(), 0, 'a second run changes nothing');

select * from finish();
rollback;
