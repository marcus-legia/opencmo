-- 20261222100000: a checkpoint tied to a version refuses a stale one before writing anything.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(4);

insert into auth.users (id, email) values ('e1940000-0000-4000-8000-00000000000a', 'checkpoint-version@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1941000-0000-4000-8000-00000000000a', 'e1940000-0000-4000-8000-00000000000a', 'storage://e1940000-0000-4000-8000-00000000000a/a.mp4', 600, 'done');
insert into public.clips (id, job_id, idx, start_seconds, end_seconds, source_start, source_end) values
  ('e1942000-0000-4000-8000-00000000000a', 'e1941000-0000-4000-8000-00000000000a', 0, 1, 20, 1, 20);

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1940000-0000-4000-8000-00000000000a"}';

select public.get_or_create_editor_project('e1942000-0000-4000-8000-00000000000a', '{"version":1,"stage":{"name":"ONE","children":[]}}'::jsonb);
create temporary table v as select version from public.editor_projects where clip_id = 'e1942000-0000-4000-8000-00000000000a';
grant select on v to authenticated;

select throws_ok(
  $$ select public.checkpoint_editor_project('e1942000-0000-4000-8000-00000000000a', 'agent', 'MCP: before restoring', (select version from v) + 1) $$,
  'P0409', 'This clip was changed in another tab.', 'a stale version is refused'
);
select is((select count(*)::int from public.editor_revisions where clip_id = 'e1942000-0000-4000-8000-00000000000a'), 0,
  'and leaves no version behind');
select lives_ok(
  $$ select public.checkpoint_editor_project('e1942000-0000-4000-8000-00000000000a', 'agent', 'MCP: before restoring', (select version from v)) $$,
  'the version the caller read is checkpointed'
);
select lives_ok(
  $$ select public.checkpoint_editor_project('e1942000-0000-4000-8000-00000000000a', 'manual', 'Before applying a style') $$,
  'callers without a version checkpoint as before'
);

select * from finish();
rollback;
