-- 20261128090000: page captures for proof B-roll — address checks, the 24 h cache, the 30-a-day
-- cap, owner-only reads, the worker's completion and a failed task failing its capture.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(32);

insert into auth.users (id, email) values
  ('e1580000-0000-4000-8000-00000000000a', 'pc-a@test.local'),
  ('e1580000-0000-4000-8000-00000000000b', 'pc-b@test.local');

-- Addresses: normalized, or refused in plain English.
select is(public.normalize_capture_url('  HTTPS://GitHub.com/owner/repo#readme '), 'https://github.com/owner/repo',
  'scheme and host lowercased, fragment dropped, spaces trimmed');
select is(public.normalize_capture_url('https://github.com:443'), 'https://github.com/', 'default port dropped, empty path is /');
select is(public.normalize_capture_url('http://example.org.uk/a?b=1'), 'http://example.org.uk/a?b=1', 'query kept');
select throws_ok($$ select public.normalize_capture_url('ftp://github.com/') $$, '22023',
  'Only http and https pages can be captured.', 'only http and https');
select throws_ok($$ select public.normalize_capture_url('file:///etc/passwd') $$, '22023',
  'Only http and https pages can be captured.', 'no local files');
select throws_ok($$ select public.normalize_capture_url('http://169.254.169.254/latest/meta-data/') $$, '22023',
  'That address is not allowed.', 'cloud metadata address refused');
select throws_ok($$ select public.normalize_capture_url('http://localhost:3000') $$, '22023',
  'That address is not allowed.', 'localhost with a port refused');
select throws_ok($$ select public.normalize_capture_url('http://localhost/') $$, '22023',
  'That address is not allowed.', 'localhost refused');
select throws_ok($$ select public.normalize_capture_url('http://127.0.0.1/') $$, '22023',
  'That address is not allowed.', 'loopback refused');
select throws_ok($$ select public.normalize_capture_url('http://10.1.2.3/') $$, '22023',
  'That address is not allowed.', 'private range refused');
select throws_ok($$ select public.normalize_capture_url('http://0x7f.0.0.1/') $$, '22023',
  'That address is not allowed.', 'hex IP trick refused');
select throws_ok($$ select public.normalize_capture_url('http://[::1]/') $$, '22023',
  'That address is not allowed.', 'IPv6 literal refused');
select throws_ok($$ select public.normalize_capture_url('https://user:pw@github.com/') $$, '22023',
  'That address is not allowed.', 'credentials in the address refused');
select throws_ok($$ select public.normalize_capture_url('https://github.com:8443/') $$, '22023',
  'That address is not allowed.', 'only default ports');
select throws_ok($$ select public.normalize_capture_url('http://intranet/') $$, '22023',
  'That address is not allowed.', 'single-label names refused');
select throws_ok($$ select public.normalize_capture_url('https://github.com/' || repeat('a', 2048)) $$, '22023',
  'That address is too long.', 'at most 2048 characters');

-- Signed out: nothing.
select throws_ok($$ select public.capture_create('https://github.com/owner/repo') $$, '28000',
  'Not signed in.', 'signed out cannot capture');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1580000-0000-4000-8000-00000000000a"}';

create temp table first_capture on commit drop as
  select public.capture_create('https://github.com/owner/repo') as id;
grant all on first_capture to public;
select is((select status from public.page_captures where id = (select id from first_capture)), 'pending', 'a new capture is pending');
select is(public.capture_create('HTTPS://github.com/owner/repo#install'), (select id from first_capture),
  'the same page within 24 h comes back from the cache');
select isnt(public.capture_create('https://github.com/owner/other'), (select id from first_capture), 'another page is another capture');
select throws_ok($$ insert into public.page_captures (user_id, url) values ('e1580000-0000-4000-8000-00000000000a', 'https://x.io/') $$,
  '42501', null, 'clients cannot write captures directly');

reset role;
select is((select payload from public.tasks where id = (select task_id from public.page_captures where id = (select id from first_capture))),
  jsonb_build_object('capture_id', (select id from first_capture), 'url', 'https://github.com/owner/repo', 'width', 1280, 'max_height', 8000),
  'one queued capture_page task with the contract spec');
select is((select count(*)::int from public.tasks where kind = 'capture_page' and user_id = 'e1580000-0000-4000-8000-00000000000a'), 2,
  'a cached capture queues no second task');

-- The cap: 28 more pages fill the 30.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1580000-0000-4000-8000-00000000000a"}';
select lives_ok($$ select public.capture_create('https://github.com/owner/repo-' || n) from generate_series(1, 28) n $$, '30 captures a day are allowed');
select throws_ok($$ select public.capture_create('https://github.com/owner/one-more') $$, 'P0001',
  'You have captured 30 pages in the last 24 hours, the most there is. Try again tomorrow.', 'the 31st is refused');
select is(public.capture_create('https://github.com/owner/repo'), (select id from first_capture), 'the cache still answers at the cap');

-- Another user sees none of it.
set local request.jwt.claims = '{"sub":"e1580000-0000-4000-8000-00000000000b"}';
select is((select count(*)::int from public.page_captures), 0, 'captures are private to their owner');
reset role;

-- Worker: finish the first capture.
update public.tasks set status = 'running', attempt_id = 'e1589000-0000-4000-8000-00000000000a'
where id = (select task_id from public.page_captures where id = (select id from first_capture));
select ok(public.complete_page_capture((select task_id from public.page_captures where id = (select id from first_capture)),
  'e1589000-0000-4000-8000-00000000000a', 'owner/repo: a repo', 1280, 5120), 'worker completes the capture');
select is((select image_path from public.page_captures where id = (select id from first_capture)),
  'e1580000-0000-4000-8000-00000000000a/' || (select id from first_capture) || '/page.png', 'ready, at the one path it may use');
select ok(public.complete_page_capture((select task_id from public.page_captures where id = (select id from first_capture)),
  'e1589000-0000-4000-8000-00000000000a', 'owner/repo: a repo', 1280, 5120), 'a repeated completion is accepted');

-- A failed task fails its capture, with the worker's sentence; the page can then be asked for again.
create temp table other_capture on commit drop as
  select id, task_id from public.page_captures where url = 'https://github.com/owner/other';
update public.tasks set status = 'running', attempt_id = 'e1589100-0000-4000-8000-00000000000a'
where id = (select task_id from other_capture);
select ok(public.fail_task((select task_id from other_capture), 'e1589100-0000-4000-8000-00000000000a',
  'That page could not be opened.'), 'worker reports a failure');
select is((select status || ': ' || error from public.page_captures where id = (select id from other_capture)),
  'failed: That page could not be opened.', 'the capture fails with the same sentence');

select * from finish();
rollback;
