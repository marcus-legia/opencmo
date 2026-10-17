-- 20261210200000: create_job refuses the SSRF encodings from the audit (fix 7).
-- The cases below are `packages/contracts/private-addresses.json`, one row each;
-- `apps/web/lib/net/address.check.ts` fails when this list and the fixture differ.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(77);

create temp table shared_cases (input text, blocked boolean) on commit drop;
insert into shared_cases values
  ('0.0.0.0', true),
  ('127.0.0.1', true),
  ('10.1.2.3', true),
  ('172.16.0.1', true),
  ('192.168.1.20', true),
  ('100.64.0.1', true),
  ('100.100.100.200', true),
  ('169.254.169.254', true),
  ('192.0.0.8', true),
  ('224.0.0.1', true),
  ('metadata.google.internal', true),
  ('localhost', true),
  ('localhost.', true),
  ('x.internal', true),
  ('x.local', true),
  ('2130706433', true),
  ('0x7f.1', true),
  ('017700000001', true),
  ('[::1]', true),
  ('[::]', true),
  ('[fd00::1]', true),
  ('[fe80::1]', true),
  ('[::ffff:127.0.0.1]', true),
  ('[::ffff:7f00:1]', true),
  ('[::ffff:a9fe:a9fe]', true),
  ('[64:ff9b::7f00:1]', true),
  ('[2002:7f00:1::]', true),
  ('[2001:0:4136:e378:8000:63bf:80ff:fffe]', true),
  ('youtube.com', false),
  ('8.8.8.8', false),
  ('[2606:4700::1111]', false);

select is(public.video_url_refused('https://' || input || '/v.mp4'), blocked, 'https ' || input)
from shared_cases;
select is(public.video_url_refused('http://' || input || '/'), blocked, 'http ' || input)
from shared_cases;

create temp table more_cases (url text, blocked boolean) on commit drop;
insert into more_cases values
  ('https://cdn.example.com:443/v.mp4', false),
  ('https://cdn.example.com:8443/v.mp4', true),
  ('http://cdn.example.com:6379/', true),
  ('https://user@cdn.example.com/v.mp4', true),
  ('https://127.1/v.mp4', true),
  ('https://0177.0.0.1/v.mp4', true),
  ('https://999.1.1.1/v.mp4', true),
  ('https://[2001:db8::1]/v.mp4', true),
  ('https://[2a00:1450:4001::200e]/v.mp4', false),
  ('HTTPS://YouTube.com/watch?v=x', false),
  ('https://youtu.be/abc#t=1', false);

select is(public.video_url_refused(url), blocked, url) from more_cases;

-- Through the public door: the refusal happens before any job or credit hold.
insert into auth.users (id, email) values ('e1800000-0000-4000-8000-00000000000a', 'ssrf@test.local');
insert into public.credit_ledger (user_id, delta, reason)
select 'e1800000-0000-4000-8000-00000000000a', 50, 'test';

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1800000-0000-4000-8000-00000000000a"}';

select throws_ok($$ select public.create_clip_job('https://[::ffff:7f00:1]/v.mp4', 3, p_ownership_confirmed => true) $$,
  '22023', 'Paste a public HTTP or HTTPS video link.', 'IPv4-mapped loopback is refused');
select throws_ok($$ select public.create_clip_job('http://metadata.google.internal/computeMetadata/v1/', 3, p_ownership_confirmed => true) $$,
  '22023', 'Paste a public HTTP or HTTPS video link.', 'the metadata name is refused');
select is((select count(*)::int from public.jobs where user_id = 'e1800000-0000-4000-8000-00000000000a'), 0, '...and no job was created');

reset role;
select is(has_function_privilege('authenticated', 'public.video_url_refused(text)', 'execute'), false,
  'the helper is not part of the browser surface');

select * from finish();
rollback;
