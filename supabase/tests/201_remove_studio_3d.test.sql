-- 3D removed (20261227090000): the `studio-3d` model is gone and cannot be generated.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(3);

insert into auth.users (id, email) values ('e2010000-0000-4000-8000-00000000000a', 'no3d-a@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e2011000-0000-4000-8000-00000000000a', 'e2010000-0000-4000-8000-00000000000a', 'https://a', 600, 'done');
insert into public.credit_ledger(user_id, delta, reason) values
  ('e2010000-0000-4000-8000-00000000000a', 10, 'test grant');

select is((select count(*) from public.ai_models where id = 'studio-3d')::int, 0, 'the studio-3d model is gone');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2010000-0000-4000-8000-00000000000a"}';

select throws_ok(
  $$ select public.create_generation('e2011000-0000-4000-8000-00000000000a', null, 'studio-3d',
       '{"prompt":"x","aspectRatio":"1:1","duration":6,"scene":{"template":"bars"}}', repeat('a', 64), gen_random_uuid()) $$,
  '22023', 'This model is not available.', 'a 3D generation is refused'
);
select is(public.credit_balance('e2010000-0000-4000-8000-00000000000a'), 10, 'nothing was held');

select * from finish();
rollback;
