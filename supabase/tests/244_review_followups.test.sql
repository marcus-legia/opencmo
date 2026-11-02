-- Review follow-ups (20270105010000). Q8: the link cases of packages/contracts/link-cases.json (check-post.check
-- verifies every case is here).
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(14);

select throws_ok($$ select public.caption_check('tiktok_caption', 'https://acme.io', null) $$, '22023', 'Captions carry no links.', 'a URL');
select throws_ok($$ select public.caption_check('tiktok_caption', 'see www.acme.io', null) $$, '22023', 'Captions carry no links.', 'a www address');
select throws_ok($$ select public.caption_check('tiktok_caption', 'opencmo.io/pricing', null) $$, '22023', 'Captions carry no links.', 'a domain with a path');
select throws_ok($$ select public.caption_check('tiktok_caption', 'Read acme.com/blog now', null) $$, '22023', 'Captions carry no links.', 'inside a sentence');
select throws_ok($$ select public.caption_check('tiktok_caption', 'go to example.fr/start', null) $$, '22023', 'Captions carry no links.', 'any TLD');
select lives_ok($$ select public.caption_check('tiktok_caption', 'Built with Next.js/React', null) $$, 'a framework name is not a link');
select lives_ok($$ select public.caption_check('tiktok_caption', 'Next.js and Node.js', null) $$, 'nor two of them');
select lives_ok($$ select public.caption_check('tiktok_caption', 'Ship the app.tsx/hooks folder', null) $$, 'nor a code path');
select lives_ok($$ select public.caption_check('tiktok_caption', 'a 50/50 split', null) $$, 'nor a fraction');
select lives_ok($$ select public.caption_check('tiktok_caption', 'Version 2.0/3.0', null) $$, 'nor version numbers');

-- R2: the dead allowlist entries and consume_daily_task_quota are gone; the buckets in use still work.
select hasnt_function('public', 'consume_daily_task_quota', array['text'], 'consume_daily_task_quota is gone');
insert into auth.users (id, email) values ('e2440000-0000-4000-8000-00000000000a', 'fu-r2@test.local');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2440000-0000-4000-8000-00000000000a"}';
select throws_ok($$ select public.rate_limit_hit('zip', 20, 3600) $$, '22023', 'Invalid rate limit.', 'the zip bucket is gone');
select throws_ok($$ select public.rate_limit_hit('mcp_preview', 30, 3600) $$, '22023', 'Invalid rate limit.', 'the 30-an-hour MCP preview is gone');
select ok(public.rate_limit_hit('mcp_preview', 60, 3600) and public.rate_limit_hit('feedback-turn', 60, 3600), 'the buckets in use still work');
reset role;

select * from finish();
rollback;
