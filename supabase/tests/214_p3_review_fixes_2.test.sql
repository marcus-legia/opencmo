-- P3 review fixes, second round (20261229120000): a caption with a domain and a path is a link, a bare domain is not;
-- approving a finished-video card with no work order behind it approves the captions it showed, and only those.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

insert into auth.users (id, email) values ('e2140000-0000-4000-8000-00000000000a', 'fixes2@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e2142000-0000-4000-8000-00000000000a', 'e2140000-0000-4000-8000-00000000000a', 'https://a', 60, 'done');
insert into public.clips (id, job_id, idx, hook, start_seconds, end_seconds, kind) values
  ('e2143000-0000-4000-8000-00000000000a', 'e2142000-0000-4000-8000-00000000000a', -1, 'Cut by words', 0, 0, 'blank');
insert into public.editor_projects (clip_id, document, manifest) values
  ('e2143000-0000-4000-8000-00000000000a', '{"version":1,"stage":{"name":"demo"}}', '{"version":1,"folders":[],"assets":[]}');

-- Links: the same line as Writer's own check.
select throws_ok($$ select public.caption_check('tiktok_caption', 'Pricing at acme.io/pricing', null) $$,
  '22023', 'Captions carry no links.', 'a domain with a path is a link');
select lives_ok($$ select public.caption_check('tiktok_caption', 'Made with Cal.com, cut by words.', null) $$,
  'a bare domain may be the product''s name');
select lives_ok($$ select public.caption_check('tiktok_caption', 'Built on Next.js and/or Postgres.', null) $$,
  'a dotted name followed by a word is not a link');

-- The founder's own edit, raised by hand: no work order, so no deliverable follows the approval.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.cmo_save_caption('e2140000-0000-4000-8000-00000000000a', null, 'e2143000-0000-4000-8000-00000000000a',
  'tiktok_caption', 'Cut your demo by deleting words.');
reset role;
select public.approval_raise('e2140000-0000-4000-8000-00000000000a', 'editor_project', 'e2143000-0000-4000-8000-00000000000a');
create temp table c (id uuid, hash text) on commit drop;
grant all on c to authenticated;
insert into c select id, content_hash from public.approvals where ref_kind = 'editor_project' and status = 'waiting'
  and user_id = 'e2140000-0000-4000-8000-00000000000a';
select is((select jsonb_array_length(snapshot->'captions') from public.approvals where id = (select id from c)), 1, 'the card shows the caption');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2140000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((public.approval_decide((select id from c), 'approve', jsonb_build_object('content_hash', (select hash from c), 'via', 'app'))).status,
  'approved', 'the founder approves the finished video');
reset role;
select is((select count(*)::int from public.deliverables where user_id = 'e2140000-0000-4000-8000-00000000000a'), 0,
  'no work order, so no deliverable');
select is((select status from public.content_items where clip_id = 'e2143000-0000-4000-8000-00000000000a' and platform = 'tiktok_caption'),
  'approved', 'the caption the card showed is approved with it');
select isnt((select decided_at from public.content_items where clip_id = 'e2143000-0000-4000-8000-00000000000a' and platform = 'tiktok_caption'),
  null, 'and decided');
-- Written after the card was decided: not on what the founder approved.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.cmo_save_caption('e2140000-0000-4000-8000-00000000000a', null, 'e2143000-0000-4000-8000-00000000000a',
  'youtube', 'A description.', 'A title');
reset role;
select is((select status from public.content_items where clip_id = 'e2143000-0000-4000-8000-00000000000a' and platform = 'youtube'),
  'in_review', 'a caption the card did not show waits');

select * from finish();
rollback;
