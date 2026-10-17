-- Draft provenance on opportunities (20261201090000): `gen` keeps only model and prompt_version,
-- short, and rows saved without it still work.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(5);

insert into auth.users (id, email) values ('e1620000-0000-4000-8000-00000000000a', 'gen-a@test.local');

set local role service_role;
select is(public.cmo_save_opportunities('e1620000-0000-4000-8000-00000000000a', null, jsonb_build_array(
  jsonb_build_object('url', 'https://www.reddit.com/r/freelance/comments/g1/a', 'title', 'Late invoices', 'score', 80, 'reply', 'r',
    'gen', jsonb_build_object('model', 'claude-sonnet-5-5', 'prompt_version', 'abc123def456', 'extra', repeat('x', 5000))),
  jsonb_build_object('url', 'https://www.reddit.com/r/freelance/comments/g2/b', 'title', 'No gen', 'score', 80, 'reply', 'r'),
  jsonb_build_object('url', 'https://www.reddit.com/r/freelance/comments/g3/c', 'title', 'Long gen', 'score', 80, 'reply', 'r',
    'gen', jsonb_build_object('model', repeat('m', 500)))
)), 3, 'three opportunities saved');
reset role;

select is((select gen from public.opportunities where title = 'Late invoices'),
  '{"model": "claude-sonnet-5-5", "prompt_version": "abc123def456"}'::jsonb, 'only model and prompt_version are kept');
select is((select gen from public.opportunities where title = 'No gen'), '{}'::jsonb, 'no gen → empty object');
select is((select char_length(gen->>'model') from public.opportunities where title = 'Long gen'), 100, 'model is cut to 100 characters');
select throws_ok($$ update public.opportunities set gen = '[]' where title = 'No gen' $$, '23514', null, 'gen must be an object');

select * from finish();
rollback;
