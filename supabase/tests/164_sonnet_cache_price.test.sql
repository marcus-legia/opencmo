-- Sonnet 5.5 cache-read price (20261201110000): $0.10 per million tokens, the rest unchanged.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(2);

select results_eq($$ select input, output, cache_read, cache_write from public.agent_model_prices where pattern = 'claude-sonnet-5%' $$,
  $$ values (2::numeric, 10::numeric, 0.1::numeric, 2.5::numeric) $$, 'Sonnet 5.5 prices');
select is(public.agent_micro_usd('claude-sonnet-5-5', 0, 0, 1000000, 0), 100000::bigint, 'a million cache-read tokens cost $0.10');

select * from finish();
rollback;
