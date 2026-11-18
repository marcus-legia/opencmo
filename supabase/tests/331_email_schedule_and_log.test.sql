-- Wave 2 A4 (20270131020002): the morning email's days and hour, a digest with no cards, a skipped day, no new
-- expiring email, the subject and summary kept, and the founder's own log of the last 14 days.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(20);

insert into auth.users (id, email) values
  ('e3310000-0000-4000-8000-00000000000a', 'el-a@test.local'),
  ('e3310000-0000-4000-8000-00000000000b', 'el-b@test.local'),
  ('e3310000-0000-4000-8000-00000000000c', 'el-c@test.local');

-- Defaults.
select is((select digest_days from public.profiles where id = 'e3310000-0000-4000-8000-00000000000a'), 'weekdays', 'weekdays by default');
select is((select digest_hour from public.profiles where id = 'e3310000-0000-4000-8000-00000000000a'), 8::smallint, 'at 8 by default');
select throws_ok($$ update public.profiles set digest_days = 'sometimes' where id = 'e3310000-0000-4000-8000-00000000000a' $$,
  '23514', null, 'only the four schedules');

-- Saving the schedule.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3310000-0000-4000-8000-00000000000a","role":"authenticated"}';
select results_eq($$ select * from public.save_cmo_settings(80, 'UTC', 9::smallint, 'monday') $$,
  $$ values (80, 'UTC'::text, 9::smallint, 'monday'::text) $$, 'the founder picks Mondays at 9');
select results_eq($$ select digest_days from public.save_cmo_settings(80, 'UTC', 9::smallint) $$,
  $$ values ('monday'::text) $$, 'an older client leaves the days alone');
select throws_ok($$ select public.save_cmo_settings(80, 'UTC', 9::smallint, 'hourly') $$, '22023',
  'Choose weekdays, every day, Mondays or off.', 'an unknown schedule is refused');
reset role;

-- A digest with no cards (follow-ups only), with its subject and summary.
create temp table c (log_id uuid, approval_ids uuid[]) on commit drop;
insert into c select * from public.email_log_claim('e3310000-0000-4000-8000-00000000000a', 'digest', '{}',
  '3 people asking about invoices', '{"people":3,"follow_ups":1,"posts":0}');
select is((select count(*)::int from c), 1, 'a digest with no cards is claimed');
select is((select row(subject, summary)::text from public.email_log where id = (select log_id from c)),
  row('3 people asking about invoices', '{"posts": 0, "people": 3, "follow_ups": 1}'::jsonb)::text, 'subject and summary are kept');
select lives_ok($$ select public.email_log_done((select log_id from c), 're_331', null) $$, 'sent');
select throws_ok($$ select * from public.email_log_claim('e3310000-0000-4000-8000-00000000000a', 'digest', '{}', null, '[1]') $$,
  '22023', null, 'a summary is an object');

-- Nothing new: a skipped day, and no send later that day.
select isnt(public.email_log_skip('e3310000-0000-4000-8000-00000000000b', 'digest', '{"reason":"nothing_new"}'), null, 'a day is skipped');
select is(public.email_log_skip('e3310000-0000-4000-8000-00000000000b', 'digest'), null, 'once a day');
select is((select count(*)::int from public.email_log_claim('e3310000-0000-4000-8000-00000000000b', 'digest', '{}')), 0,
  'a skipped day sends nothing later');
select throws_ok($$ select public.email_log_skip('e3310000-0000-4000-8000-00000000000b', 'push') $$, '22023', null,
  'only emails are skipped');

-- Off, and the expiring email.
update public.profiles set digest_days = 'off' where id = 'e3310000-0000-4000-8000-00000000000c';
select is((select count(*)::int from public.email_log_claim('e3310000-0000-4000-8000-00000000000c', 'digest', '{}')), 0,
  'off sends no morning email');
select is((select count(*)::int from public.email_log_claim('e3310000-0000-4000-8000-00000000000c', 'expiring', '{}')), 0,
  'no expiring email is claimed any more');

-- The founder's own log.
insert into public.email_log (user_id, kind, day, approval_ids, status, created_at) values
  ('e3310000-0000-4000-8000-00000000000a', 'digest', current_date - 20, '{}', 'sent', now() - interval '20 days'),
  ('e3310000-0000-4000-8000-00000000000a', 'weekly', current_date - 1, '{}', 'failed', now() - interval '1 day');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3310000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((select count(*)::int from public.my_email_log(30)), 1, 'sent and skipped of the last 14 days only');
select is((select subject from public.my_email_log(30)), '3 people asking about invoices', 'with the subject');
select throws_ok($$ select * from public.my_email_log(0) $$, '22023', null, 'a sane limit');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3310000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is((select status from public.my_email_log(30)), 'skipped', 'another founder sees only their own, skipped days too');
reset role;

select * from finish();
rollback;
