-- Provider spend ledger (20270104010000): founders cannot read or write it except their own lookups, prices are
-- stored with each row, an unpriced unit stays unpriced, the daily cap trips, and the report is for owners only.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(16);

select ok(not has_table_privilege('authenticated', 'public.provider_usage', 'select'), 'founders cannot read the ledger');
select ok(not has_table_privilege('authenticated', 'public.provider_prices', 'select'), 'nor the prices');
select ok(not has_function_privilege('authenticated', 'public.provider_usage_record(uuid, text, text, jsonb, text, uuid)', 'execute'),
  'only the service records arbitrary usage');
select ok(not has_function_privilege('authenticated', 'public.provider_spend_today(uuid)', 'execute'), 'nor reads another founder''s spend');

insert into auth.users (id, email) values
  ('e2430000-0000-4000-8000-00000000000a', 'spend-a@test.local'),
  ('e2430000-0000-4000-8000-00000000000b', 'owner@test.local');

set local role service_role;
select is(public.provider_usage_record('e2430000-0000-4000-8000-00000000000a', 'scrapecreators', '/v1/reddit/search', '{"call": 1}', 'cmo_run', null),
  2000::bigint, 'a lookup is priced from provider_prices');
select is(public.provider_usage_record('e2430000-0000-4000-8000-00000000000a', 'anthropic', 'claude-sonnet-5-5', '{"input": 1000, "output": 100}', 'cmo_run', null),
  public.agent_micro_usd('claude-sonnet-5-5', 1000, 100, 0, 0), 'a model call is priced like the Assistant');
select is(public.provider_usage_record('e2430000-0000-4000-8000-00000000000a', 'fal', 'fal-veo', '{"second": 8}', 'generation', null),
  0::bigint, 'a unit with no price is not guessed');
select is((select priced from public.provider_usage where provider = 'fal'), false, 'and is marked unpriced');

-- A later price never rewrites history.
insert into public.provider_prices (provider, unit, micro_usd, valid_from) values ('scrapecreators', 'call', 9000, now() - interval '1 second');
select is((select micro_usd from public.provider_usage where provider = 'scrapecreators'), 2000::bigint, 'stored rows keep their price');
select is(public.provider_usage_record('e2430000-0000-4000-8000-00000000000a', 'scrapecreators', '/v1/x/user', '{"call": 1}'), 9000::bigint,
  'new rows take the new price');

-- The cap.
select ok(public.provider_spend_allowed_for('e2430000-0000-4000-8000-00000000000a'), 'under the cap');
update public.provider_spend_cap set micro_usd = 10000;
select ok(not public.provider_spend_allowed_for('e2430000-0000-4000-8000-00000000000a'), 'past the cap, new paid calls are refused');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2430000-0000-4000-8000-00000000000a","email":"spend-a@test.local"}';
select ok(not public.provider_spend_allowed(), 'the founder''s own check agrees');
select throws_ok($$ select public.provider_usage_record_mine('/v1/reddit/search', 5) $$, '22023', 'One lookup at a time.',
  'a founder records one lookup at a time, at the server''s price');
select throws_ok($$ select public.provider_spend_report(7) $$, '42501', 'Not available.', 'the report is for owners only');
reset role;

insert into public.app_owners (email) values ('owner@test.local');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2430000-0000-4000-8000-00000000000b","email":"owner@test.local"}';
select is((public.provider_spend_report(7)->>'unpriced_calls')::int, 1, 'the owner sees totals, including unpriced calls');

select * from finish();
rollback;
