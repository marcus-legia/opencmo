-- Review of #238, finding 7 (20270131020007): a settings save changes only the keys it names, in one statement.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(6);

insert into auth.users (id, email) values ('e3360000-0000-4000-8000-00000000000a', 'sp-a@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3360000-0000-4000-8000-00000000000a","role":"authenticated"}';
select results_eq($$ select digest_hour, digest_days from public.save_cmo_settings_patch('{"digest_hour":7,"digest_days":"daily"}') $$,
  $$ values (7::smallint, 'daily'::text) $$, 'the Notifications panel saves its two keys');
select results_eq($$ select weekly_credit_budget, digest_hour, digest_days from public.save_cmo_settings_patch('{"weekly_credit_budget":120}') $$,
  $$ values (120, 7::smallint, 'daily'::text) $$, 'the budget save leaves the email schedule alone');
select results_eq($$ select digest_hour from public.save_cmo_settings_patch('{"digest_hour":null}') $$,
  $$ values (null::smallint) $$, 'null still means no hour');
select throws_ok($$ select public.save_cmo_settings_patch('{}') $$, '22023', 'Nothing to save.', 'an empty save is refused');
select throws_ok($$ select public.save_cmo_settings_patch('{"timezone":"Mars/Base"}') $$, '22023', 'Choose a time zone from the list.', 'an unknown zone is refused');
reset role;
select ok(not has_function_privilege('anon', 'public.save_cmo_settings_patch(jsonb)', 'execute'), 'not for anonymous callers');

select * from finish();
rollback;
