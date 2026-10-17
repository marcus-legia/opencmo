-- 20261119090000: Sonnet usage is priced as Sonnet and can open a session.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(4);

select is(public.agent_micro_usd('claude-sonnet-5-5', 1000000, 1000000, 0, 0), 12000000::bigint, 'Sonnet 5.5: $2 + $10 per million');
select is(public.agent_micro_usd('claude-sonnet-5-5', 0, 0, 1000000, 1000000), 2600000::bigint, 'Sonnet 5.5 cache read ($0.10 since 20261201110000) and write');
select ok((public.agent_price('claude-sonnet-5-5')).allowed, 'Sonnet 5.5 may open a session');
select is(public.agent_micro_usd('claude-opus-5-5', 1000, 100, 0, 0), 7500::bigint, 'Opus unchanged');

select * from finish();
rollback;
