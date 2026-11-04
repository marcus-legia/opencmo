-- cmo-review B1.7 (20270106010000): the browser's zone is written once, only while the founder never chose one.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

insert into auth.users (id, email) values
  ('e2450000-0000-4000-8000-00000000000a', 'tz@test.local');

select ok(not has_function_privilege('anon', 'public.profile_timezone_detect(text)', 'execute'), 'anon cannot set a zone');
select is((select timezone_source from public.profiles where id = 'e2450000-0000-4000-8000-00000000000a'), 'default', 'a new account starts on the default');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2450000-0000-4000-8000-00000000000a","role":"authenticated"}';

select is(public.profile_timezone_detect('Not/AZone'), 'UTC', 'an unknown zone is ignored');
select is(public.profile_timezone_detect('Asia/Ho_Chi_Minh'), 'Asia/Ho_Chi_Minh', 'the browser zone is written');
select is(public.profile_timezone_detect('Europe/Paris'), 'Asia/Ho_Chi_Minh', 'only once: a second browser does not move it');

select lives_ok($$ select * from public.save_cmo_settings(80, 'UTC', null) $$, 'the founder picks UTC in Settings');
select is(public.profile_timezone_detect('Asia/Tokyo'), 'UTC', 'the founder''s own choice, even UTC, is kept');

reset role;
select is((select timezone_source from public.profiles where id = 'e2450000-0000-4000-8000-00000000000a'), 'founder', 'Settings marks the zone as chosen');
select throws_ok($$ update public.profiles set timezone_source = 'robot' where id = 'e2450000-0000-4000-8000-00000000000a' $$,
  '23514', null, 'only default, browser or founder');

select * from finish();
rollback;
