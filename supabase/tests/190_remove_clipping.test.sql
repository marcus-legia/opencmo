-- 20261220090000: clipping, link imports and CMO video packs are gone; an upload is the one way to
-- start a project.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(18);

select hasnt_table('public', 'video_ownership', 'video ownership confirmations are gone');
select hasnt_table('public', 'video_packs', 'video packs are gone');
select hasnt_table('public', 'cmo_video_briefs', 'video briefs are gone');

select hasnt_function('public', 'create_clip_job', 'create_clip_job is gone');
select hasnt_function('public', 'create_job', 'create_job is gone');
select hasnt_function('public', 'publish_job_clip', 'clip-by-clip publication is gone');
select hasnt_function('public', 'request_zip', 'project ZIPs are gone');
select hasnt_function('public', 'create_full_edit', 'the separate full-edit hop is gone');
select hasnt_function('public', 'video_url_refused', 'the link guard is gone with links');

select ok(not has_function_privilege('anon', 'public.create_upload_edit(text,text,boolean)', 'execute'),
  'anon cannot start a project');
select ok(has_function_privilege('authenticated', 'public.create_upload_edit(text,text,boolean)', 'execute'),
  'a signed-in user can');

select col_default_is('public', 'clips', 'kind', 'full', 'a published clip is the whole upload');

insert into auth.users (id, email) values ('e1900000-0000-4000-8000-00000000000a', 'rc@test.local');
insert into public.jobs (id, user_id, source_url)
values ('e1910000-0000-4000-8000-00000000000a', 'e1900000-0000-4000-8000-00000000000a',
        'storage://e1900000-0000-4000-8000-00000000000a/a.mp4');

select throws_ok(
  $$ insert into public.tasks (user_id, kind, job_id, request_id)
     values ('e1900000-0000-4000-8000-00000000000a', 'zip', 'e1910000-0000-4000-8000-00000000000a', gen_random_uuid()) $$,
  '23514', null, 'a zip task is refused'
);
select throws_ok(
  $$ insert into public.tasks (user_id, kind, job_id, request_id)
     values ('e1900000-0000-4000-8000-00000000000a', 'prepare_full', 'e1910000-0000-4000-8000-00000000000a', gen_random_uuid()) $$,
  '23514', null, 'a prepare_full task is refused'
);
select throws_ok(
  $$ insert into public.cmo_runs (user_id, kind) values ('e1900000-0000-4000-8000-00000000000a', 'video_pack') $$,
  '23514', null, 'a video pack run is refused'
);
select is(public.cmo_job_price('video_pack'), 0, 'video packs have no price');
select is(public.cmo_job_daily_limit('video_pack'), 0, 'and no daily allowance');
select throws_ok(
  $$ select public.cmo_propose_goal('e1900000-0000-4000-8000-00000000000a', null, date_trunc('week', current_date)::date, 'Approve 3 clip packs', 'clips', 3) $$,
  '22023', 'The goal must count posts, replies or views.', 'a clips goal is refused: video packs are gone'
);

select * from finish();
rollback;
