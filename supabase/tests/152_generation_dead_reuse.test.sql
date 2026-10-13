-- 20261122090000: a done generation whose file was deleted is not reused; the same spec makes a new one.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(5);

insert into auth.users (id, email) values ('e1520000-0000-4000-8000-0000000000aa', 'dead-a@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1521000-0000-4000-8000-0000000000aa', 'e1520000-0000-4000-8000-0000000000aa', 'https://a', 600, 'done');
insert into public.credit_ledger(user_id, delta, reason) values ('e1520000-0000-4000-8000-0000000000aa', 10, 'test grant');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1520000-0000-4000-8000-0000000000aa"}';
create temporary table g_first as
  select public.create_generation('e1521000-0000-4000-8000-0000000000aa', null,
    'fake-image', '{"prompt":"a red fox","aspectRatio":"1:1"}', repeat('7', 64), gen_random_uuid()) as r;
grant select on g_first to authenticated;
reset role;

-- It finished, then its file was deleted from the library (the foreign key sets the asset null).
update public.generations set status = 'done', media_asset_id = null where id = (select (r->'generation'->>'id')::uuid from g_first);

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1520000-0000-4000-8000-0000000000aa"}';
create temporary table g_again as
  select public.create_generation('e1521000-0000-4000-8000-0000000000aa', null,
    'fake-image', '{"prompt":"a red fox","aspectRatio":"1:1"}', repeat('7', 64), gen_random_uuid()) as r;
grant select on g_again to authenticated;
reset role;

select is((select r->>'reused' from g_again), 'false', 'the dead generation is not handed back');
select isnt((select r->'generation'->>'id' from g_again), (select r->'generation'->>'id' from g_first), 'a new generation');
select is((select spec_hash from public.generations where id = (select (r->'generation'->>'id')::uuid from g_again)), repeat('7', 64), 'the new one owns the hash');
select ok((select spec_hash ~ '^[0-9a-f]{64}$' and spec_hash <> repeat('7', 64) from public.generations where id = (select (r->'generation'->>'id')::uuid from g_first)), 'the old one keeps a retired, valid hash');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1520000-0000-4000-8000-0000000000aa"}';
select is(
  (select r->>'reused' from (select public.create_generation('e1521000-0000-4000-8000-0000000000aa', null,
    'fake-image', '{"prompt":"a red fox","aspectRatio":"1:1"}', repeat('7', 64), gen_random_uuid()) as r) x),
  'true', 'a live generation is still reused'
);

select * from finish();
rollback;
