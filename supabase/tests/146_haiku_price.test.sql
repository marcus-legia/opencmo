-- 20261116090000: Haiku usage is priced as Haiku, not at the Opus fallback.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(4);

select is(public.agent_micro_usd('claude-haiku-5-5', 1000000, 1000000, 0, 0), 600000::bigint, 'Haiku 5.5: $0.10 + $0.50 per million');
select is(public.agent_micro_usd('claude-haiku-5-5', 0, 0, 1000000, 1000000), 135000::bigint, 'Haiku 5.5 cache read and write');
select is(public.agent_micro_usd('claude-haiku-4-5', 1000, 100, 0, 0), 1500::bigint, 'Haiku 4.5: 1000x1 + 100x5');
select is(public.agent_micro_usd('claude-opus-5-5', 1000, 100, 0, 0), 7500::bigint, 'Opus unchanged');

select * from finish();
rollback;
