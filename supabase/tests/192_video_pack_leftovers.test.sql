-- 20261221100000: a video-pack job left without its project row is refunded if in flight, then deleted.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(7);

select ok(not has_function_privilege('authenticated', 'public.remove_video_pack_leftovers()', 'execute'),
  'a user cannot run the cleanup');

insert into auth.users (id, email) values ('e1920000-0000-4000-8000-00000000000a', 'vp-left@test.local');
insert into public.credit_ledger (user_id, delta, reason) values ('e1920000-0000-4000-8000-00000000000a', 30, 'test grant');
insert into public.jobs (id, user_id, source_url, status) values
  ('e1921000-0000-4000-8000-00000000000a', 'e1920000-0000-4000-8000-00000000000a', 'storage://e1920000-0000-4000-8000-00000000000a/run.mp4', 'running'),
  ('e1921000-0000-4000-8000-00000000000b', 'e1920000-0000-4000-8000-00000000000a', 'storage://e1920000-0000-4000-8000-00000000000a/done.mp4', 'done'),
  ('e1921000-0000-4000-8000-00000000000c', 'e1920000-0000-4000-8000-00000000000a', 'storage://e1920000-0000-4000-8000-00000000000a/kept.mp4', 'running');
select public.credit_hold('e1920000-0000-4000-8000-00000000000a', 'job', id, 5, 'Hold for new job', id)
from public.jobs where user_id = 'e1920000-0000-4000-8000-00000000000a';
-- What the applied 20261220090000 left behind: the first two lost their (video-pack) project row.
delete from public.projects where job_id in ('e1921000-0000-4000-8000-00000000000a', 'e1921000-0000-4000-8000-00000000000b');

select is(public.remove_video_pack_leftovers(), 2, 'both leftovers are deleted');
select is(public.credit_held('job', 'e1921000-0000-4000-8000-00000000000a'), 0, 'the one in flight is refunded');
select is(public.credit_held('job', 'e1921000-0000-4000-8000-00000000000b'), 5, 'finished work keeps its charge');
select ok(exists (select 1 from public.jobs where id = 'e1921000-0000-4000-8000-00000000000c'), 'a job with its project stays');
select is(public.credit_held('job', 'e1921000-0000-4000-8000-00000000000c'), 5, 'and keeps its hold');
select is(public.remove_video_pack_leftovers(), 0, 'running it again changes nothing');

select * from finish();
rollback;
