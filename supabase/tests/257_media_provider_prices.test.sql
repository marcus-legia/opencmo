-- fal and ElevenLabs prices (20270111010000): the units the worker records are priced, an unknown one stays unpriced,
-- and the rows are still hidden from founders.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

select ok(not has_table_privilege('authenticated', 'public.provider_prices', 'select'), 'founders still cannot read prices');

select is(public.provider_price('fal', 'fal-veo:second'), 200000::numeric, 'Veo 3.1 is priced per second');
select is(public.provider_price('elevenlabs', 'elevenlabs-voice:kchars'), 80000::numeric, 'ElevenLabs voice per 1,000 characters');
select is((select count(*)::int from public.provider_prices where valid_from = '2026-11-08 00:00:00+00' and note like 'PROVISIONAL:%'), 12,
  'twelve units priced, each marked provisional');

insert into auth.users (id, email) values ('e2570000-0000-4000-8000-00000000000a', 'prices-a@test.local');

set local role service_role;
-- The shape opencmo/ai/spend.py sends: {"<model id>:<unit>": count}.
select is(public.provider_usage_record('e2570000-0000-4000-8000-00000000000a', 'fal', 'fal-veo', '{"fal-veo:second": 8}', 'generation', null),
  1600000::bigint, 'an 8 s Veo shot costs $1.60');
select is(public.provider_usage_record('e2570000-0000-4000-8000-00000000000a', 'elevenlabs', 'elevenlabs-voice', '{"elevenlabs-voice:kchars": 2}', 'generation', null),
  160000::bigint, '2,000 characters of voice cost $0.16');
select is((select bool_and(priced) from public.provider_usage where user_id = 'e2570000-0000-4000-8000-00000000000a'), true, 'both rows are priced');
select is(public.provider_usage_record('e2570000-0000-4000-8000-00000000000a', 'fal', 'fal-veed-cutout', '{"fal-veed-cutout:second": 5}', 'generation', null),
  0::bigint, 'a model with no known price is not guessed');
select is((select priced from public.provider_usage where model_or_endpoint = 'fal-veed-cutout'), false, 'and is marked unpriced');
reset role;

select * from finish();
rollback;
