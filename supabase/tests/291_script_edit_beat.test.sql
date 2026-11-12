-- cmo-review-3 I1 (20270115020000): a beat edited from the editor's Script tab writes the Writer's order, the script's
-- one home. Only that beat changes; a stale version is refused; before approval, for another founder, or out of range
-- it is refused; the approved card's snapshot stays the record of what was approved.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(13);

select ok(not has_function_privilege('anon', 'public.cmo_script_edit_beat(uuid,integer,text,text,timestamptz)', 'execute'), 'anon cannot edit');

insert into auth.users (id, email) values
  ('e2910000-0000-4000-8000-00000000000a', 'beat-a@test.local'),
  ('e2910000-0000-4000-8000-00000000000b', 'beat-b@test.local');
update public.profiles set credit_balance = 50 where id = 'e2910000-0000-4000-8000-00000000000a';
insert into public.cmo_insights (user_id, kind, body) values ('e2910000-0000-4000-8000-00000000000a', 'niche_video', '{}');
create temp table t (name text primary key, id uuid) on commit drop;
grant all on t to authenticated;

-- A week plan's script, written by Writer (as 273_script_open makes one).
insert into public.cmo_runs (id, user_id, kind, status) values
  ('e2911000-0000-4000-8000-00000000000a', 'e2910000-0000-4000-8000-00000000000a', 'plan_week', 'running');
select public.cmo_plan_week('e2910000-0000-4000-8000-00000000000a', 'e2911000-0000-4000-8000-00000000000a',
  jsonb_build_array(jsonb_build_object('day', current_date, 'department', 'video', 'platform', 'Shorts', 'idea', 'A demo', 'reason', 'r')));
insert into t select 'brief', id from public.work_orders where kind = 'write_video_brief' and user_id = 'e2910000-0000-4000-8000-00000000000a';
update public.cmo_runs set status = 'done', finished_at = now(), output = jsonb_build_object('reason', 'r',
  'brief', jsonb_build_object('objective', 'Show the demo', 'hooks', jsonb_build_array('a', 'b', 'c'), 'seconds', 30, 'aspect', '9:16',
    'storyboard', jsonb_build_array(jsonb_build_object('say', 'First words.', 'show', 'You', 'shot', 'talking_head', 'seconds', 10),
      jsonb_build_object('say', 'Second words.', 'show', 'Screen', 'shot', 'screen', 'seconds', 10),
      jsonb_build_object('say', 'Third words.', 'show', 'You', 'shot', 'talking_head', 'seconds', 10))))
where input->>'order_id' = (select id from t where name = 'brief')::text;
insert into t select 'card', id from public.approvals where ref_kind = 'work_order' and ref_id = (select id from t where name = 'brief');

create temp table v (version timestamptz) on commit drop;
grant all on v to authenticated;
insert into v select updated_at from public.work_orders where id = (select id from t where name = 'brief');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2910000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok(format($$ select public.cmo_script_edit_beat(%L, 2, 'New words.', null, %L) $$, (select id from t where name = 'brief'), (select version from v)),
  'P0001', 'Approve the script first.', 'not before the founder approves it');
select public.approval_decide((select id from t where name = 'card'), 'approve',
  jsonb_build_object('content_hash', (select content_hash from public.approvals where id = (select id from t where name = 'card'))));
reset role;
delete from v;
insert into v select updated_at from public.work_orders where id = (select id from t where name = 'brief');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2910000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok(format($$ select public.cmo_script_edit_beat(%L, 4, 'New words.', null, %L) $$, (select id from t where name = 'brief'), (select version from v)),
  '22023', null, 'a beat the script does not have is refused');
select throws_ok(format($$ select public.cmo_script_edit_beat(%L, 2, '  ', null, %L) $$, (select id from t where name = 'brief'), (select version from v)),
  '22023', null, 'empty words are refused');
select throws_ok(format($$ select public.cmo_script_edit_beat(%L, 2, %L, null, %L) $$, (select id from t where name = 'brief'), repeat('x', 301), (select version from v)),
  '22023', null, 'over 300 characters is refused');
-- A brief near its 8192-byte cap: a longer beat is refused in words, not by the constraint.
reset role;
update public.work_orders set brief = jsonb_set(brief, '{key_points}', to_jsonb(repeat('k', 7300))) where id = (select id from t where name = 'brief');
delete from v;
insert into v select updated_at from public.work_orders where id = (select id from t where name = 'brief');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2910000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok(format($$ select public.cmo_script_edit_beat(%L, 1, %L, %L, %L) $$, (select id from t where name = 'brief'), repeat('s', 300), repeat('w', 300), (select version from v)),
  '22023', 'This script is too long to save. Shorten this beat or another one.', 'a beat that would overflow the brief is refused in words');
reset role;
update public.work_orders set brief = brief - 'key_points' where id = (select id from t where name = 'brief');
delete from v;
insert into v select updated_at from public.work_orders where id = (select id from t where name = 'brief');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2910000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok(format($$ select public.cmo_script_edit_beat(%L, 2, 'New second words.', null, %L) $$, (select id from t where name = 'brief'), (select version from v)),
  'the founder edits beat 2');
select throws_ok(format($$ select public.cmo_script_edit_beat(%L, 3, 'Late words.', null, %L) $$, (select id from t where name = 'brief'), (select version from v)),
  'P0001', 'This script changed. Look at it again before editing.', 'the old version is refused');
reset role;

select is((select brief->'storyboard'->1->>'say' from public.work_orders where id = (select id from t where name = 'brief')), 'New second words.', 'beat 2 says the new words');
select is((select brief->'storyboard'->1->>'show' from public.work_orders where id = (select id from t where name = 'brief')), 'Screen', 'what to show is kept');
select is((select (brief->'storyboard'->0->>'say') || (brief->'storyboard'->2->>'say') from public.work_orders where id = (select id from t where name = 'brief')),
  'First words.Third words.', 'no other beat changes');
select ok((select snapshot::text not like '%New second words%' from public.approvals where id = (select id from t where name = 'card')),
  'the approved card keeps what was approved');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2910000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok(format($$ select public.cmo_script_edit_beat(%L, 1, 'Mine now.', null, now()) $$, (select id from t where name = 'brief')),
  'P0002', 'Script not found.', 'another founder''s script is not found');
reset role;

select * from finish();
rollback;
