-- 20270120010000: a founder saves their own posting plan; the bounds hold; nobody else can write it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(10);

select ok(has_function_privilege('authenticated', 'public.save_posting_plan(jsonb)', 'execute'), 'a founder sets their own plan');
select ok(not has_function_privilege('anon', 'public.save_posting_plan(jsonb)', 'execute'), 'anon cannot');

insert into auth.users (id, email) values
  ('e2990000-0000-4000-8000-00000000000a', 'plan-a@test.local'),
  ('e2990000-0000-4000-8000-00000000000b', 'plan-b@test.local');
insert into public.profiles (id, email) values
  ('e2990000-0000-4000-8000-00000000000a', 'plan-a@test.local'),
  ('e2990000-0000-4000-8000-00000000000b', 'plan-b@test.local')
on conflict (id) do nothing;

select is((select posting_plan from public.profiles where id = 'e2990000-0000-4000-8000-00000000000a'), null, 'no plan until the founder chooses');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2990000-0000-4000-8000-00000000000a"}';

select lives_ok($$ select public.save_posting_plan('{"text":{"x":2,"threads":1,"linkedin":0},"video":{"tiktok":3,"instagram":0,"youtube":7}}'::jsonb) $$, 'a valid plan is saved');
select throws_ok($$ select public.save_posting_plan('{"text":{"x":4,"threads":1,"linkedin":0},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  '22023', 'Posts a day must be between 0 and 3.', 'four posts a day is refused');
select throws_ok($$ select public.save_posting_plan('{"text":{"x":1,"threads":1,"linkedin":0},"video":{"tiktok":8,"instagram":0,"youtube":0}}'::jsonb) $$,
  '22023', 'Videos a week must be between 0 and 7.', 'eight videos a week is refused');
select throws_ok($$ select public.save_posting_plan('{"text":{"x":1,"threads":1,"linkedin":0,"myspace":1},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  '22023', null, 'an unknown platform is refused');
select throws_ok($$ select public.save_posting_plan('{"text":{"x":1.5,"threads":1,"linkedin":0},"video":{"tiktok":0,"instagram":0,"youtube":0}}'::jsonb) $$,
  '22023', null, 'half a post is refused');

reset role;
select is((select posting_plan->'text'->>'x' from public.profiles where id = 'e2990000-0000-4000-8000-00000000000a'), '2', 'the saved plan is stored; the refused ones changed nothing');
select is((select posting_plan from public.profiles where id = 'e2990000-0000-4000-8000-00000000000b'), null, 'another founder''s plan is untouched');

select * from finish();
rollback;
