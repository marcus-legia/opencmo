-- Review follow-ups (20270105010000). Q8: the link cases of packages/contracts/link-cases.json (check-post.check
-- verifies every case is here).
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(10);

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

select * from finish();
rollback;
