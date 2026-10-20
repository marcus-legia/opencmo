-- 20261219000000: a clip job needs picked moments, from the clip form and from a CMO video pack.
--
-- Runs as `authenticated` with a fake JWT, the path PostgREST takes. Credits are checked so a
-- refused job is seen to hold nothing.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(13);

insert into auth.users (id, email)
values ('18400000-0000-4000-8000-00000000000a', 'moments@test.local');
insert into public.credit_ledger (user_id, delta, reason)
values ('18400000-0000-4000-8000-00000000000a', 500, 'Test top-up');

-- Each case below creates at most one job; done jobs do not count toward the 3-in-progress cap.
create function pg_temp.drain_jobs() returns void
language sql security definer set search_path = public as $fn$
  update public.jobs set status = 'done' where user_id = '18400000-0000-4000-8000-00000000000a' and status in ('queued', 'running');
  update public.cmo_runs set status = 'done' where user_id = '18400000-0000-4000-8000-00000000000a' and status in ('queued', 'running');
$fn$;

create function pg_temp.balance() returns int
language sql security definer set search_path = public as $fn$
  select credit_balance from public.profiles where id = '18400000-0000-4000-8000-00000000000a';
$fn$;

create temp table before as select pg_temp.balance() as credits;
grant select on before to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"18400000-0000-4000-8000-00000000000a"}';

-- ---------------------------------------------------------------- clip form
select throws_ok(
  $$ select public.create_clip_job('storage://media/18400000-0000-4000-8000-00000000000a/a.mp4', 5) $$,
  '22023', 'Pick at least one moment to clip.', 'an upload with no moments is refused'
);
select throws_ok(
  $$ select public.create_clip_job('https://youtu.be/none', 5, 'auto', '[]'::jsonb, p_ownership_confirmed => true) $$,
  '22023', 'Pick at least one moment to clip.', 'an empty list of moments is refused'
);
select throws_ok(
  $$ select public.create_clip_job('https://youtu.be/none', 5, 'long', null, 'clip', p_ownership_confirmed => true) $$,
  '22023', 'Pick at least one moment to clip.', 'a clip length does not stand in for moments'
);
select is((select count(*)::int from public.jobs), 0, 'no job was created for a refused request');
select is(pg_temp.balance(), (select credits from before), 'and no credits were held');

select is(
  (public.create_clip_job('https://youtu.be/three', 5, 'auto',
    '[{"start":0,"end":20},{"start":40,"end":70},{"start":100,"end":130}]'::jsonb,
    p_ownership_confirmed => true)).clips_requested,
  3, 'the clip count is the number of moments, not p_clips'
);
select pg_temp.drain_jobs();
select is(
  (public.create_clip_job('https://youtu.be/whole', 5, 'auto', null, 'full', p_ownership_confirmed => true)).clips_requested,
  1, 'a whole-video job needs no moments'
);
select pg_temp.drain_jobs();

-- ---------------------------------------------------------------- video pack
select throws_ok(
  $$ select public.create_video_pack('https://youtu.be/pack-none', true, 5) $$,
  '22023', 'Pick at least one moment to clip.', 'a video pack with no moments is refused'
);
select is((select count(*)::int from public.cmo_runs where kind = 'video_pack'), 0, 'and no video pack run was queued');

create temp table pack as
  select public.create_video_pack('https://youtu.be/pack-two', true, 5,
    '[{"start":10,"end":40},{"start":90,"end":120}]'::jsonb) as v;
select is(
  (select (v -> 'job' ->> 'clips_requested')::int from pack), 2,
  'a video pack clips exactly the picked moments'
);
select is(
  (select jsonb_array_length(segments) from public.jobs where id = (select (v -> 'job' ->> 'id')::uuid from pack)), 2,
  'the video pack job stores the moments'
);

reset role;
select is(
  has_function_privilege('authenticated', 'public.create_video_pack(text, boolean, integer, jsonb)', 'execute'), true,
  'the founder can call the new video pack signature'
);
select is(
  (select count(*)::int from pg_proc where proname = 'create_video_pack' and pronamespace = 'public'::regnamespace), 1,
  'the old three-argument video pack is gone'
);

select * from finish();
rollback;
