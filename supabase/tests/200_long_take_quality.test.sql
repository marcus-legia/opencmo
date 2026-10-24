-- Long take, Task 6 (20261226100000): `complete_generation` stores the garbled-text hint on a finished image,
-- drops a bad one without failing the generation, and only the owner reads it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

insert into auth.users (id, email) values
  ('e1980000-0000-4000-8000-00000000000a', 'quality@test.local'),
  ('e1980000-0000-4000-8000-00000000000b', 'quality-other@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1981000-0000-4000-8000-00000000000a', 'e1980000-0000-4000-8000-00000000000a', 'https://a', 600, 'done');
insert into public.credit_ledger(user_id, delta, reason) values
  ('e1980000-0000-4000-8000-00000000000a', 50, 'test grant');

create temp table t_gen (name text primary key, id uuid) on commit drop;
grant all on t_gen to authenticated;

-- Creates a generation as the owner, claims its task as the worker, and completes it with `p_quality`.
create function pg_temp.made(p_name text, p_model text, p_spec jsonb, p_quality jsonb) returns boolean language plpgsql as $$
declare
  v_id uuid;
  v_task record;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"e1980000-0000-4000-8000-00000000000a"}', true);
  v_id := (public.create_generation('e1981000-0000-4000-8000-00000000000a', null, p_model, p_spec,
    encode(sha256(convert_to(p_name, 'UTF8')), 'hex'), gen_random_uuid())->'generation'->>'id')::uuid;
  perform set_config('role', 'postgres', true);
  insert into t_gen values (p_name, v_id);
  select * into v_task from public.claim_next_task(array['generate'], 300) where payload->>'generation_id' = v_id::text;
  return public.complete_generation(v_task.id, v_task.attempt_id,
    'e1980000-0000-4000-8000-00000000000a/e1981000-0000-4000-8000-00000000000a/gen-' || v_task.attempt_id || '.png',
    'keyframe.png', null, 1080, 1920, 1, null, p_quality);
end;
$$;
create function pg_temp.quality(p_name text) returns jsonb language sql as $$
  select quality from public.generations where id = (select id from t_gen where name = p_name)
$$;

select ok(pg_temp.made('severe', 'fake-image', '{"prompt":"a shop sign","aspectRatio":"9:16"}', '{"text":"severe"}'),
  'an image completes with its text hint');
select is(pg_temp.quality('severe'), '{"text":"severe"}'::jsonb, 'and keeps it');
select ok(pg_temp.made('clean', 'fake-image', '{"prompt":"a desk","aspectRatio":"9:16"}', '{"text":"none"}'), 'a clean one too');
select is(pg_temp.quality('clean'), '{"text":"none"}'::jsonb, 'stored as none');

select ok(pg_temp.made('odd', 'fake-image', '{"prompt":"a cafe","aspectRatio":"9:16"}', '{"text":"awful","x":1}'),
  'a bad hint never fails a paid generation');
select is(pg_temp.quality('odd'), null, 'it is dropped');
select ok(pg_temp.made('unchecked', 'fake-image', '{"prompt":"a park","aspectRatio":"9:16"}', null), 'no hint: not checked');
select is(pg_temp.quality('unchecked'), null, 'stays null');

select ok(pg_temp.made('video', 'fake-video', '{"prompt":"waves","aspectRatio":"9:16","duration":3}', '{"text":"severe"}'),
  'a video completes');
select is(pg_temp.quality('video'), null, 'but only images carry the hint');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1980000-0000-4000-8000-00000000000b"}';
select is((select count(*)::int from public.generations where quality is not null), 0, 'another user reads no hint');
set local request.jwt.claims = '{"sub":"e1980000-0000-4000-8000-00000000000a"}';
select is((select count(*)::int from public.generations where quality is not null), 2, 'the owner reads both');

select * from finish();
rollback;
