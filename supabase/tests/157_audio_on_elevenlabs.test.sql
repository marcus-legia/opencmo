-- 20261127090000: ElevenLabs audio calls ElevenLabs directly; Gemini voice is off.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(5);

select is(
  (select count(*)::int from public.ai_models
   where id in ('elevenlabs-voice', 'elevenlabs-sfx', 'elevenlabs-music') and provider = 'elevenlabs'),
  3, 'voice, sound effects and music route to ElevenLabs directly'
);
select is(
  (select array_agg(id order by id) from public.ai_models where kind = 'voice' and enabled and provider <> 'fake'),
  array['elevenlabs-voice'], 'ElevenLabs is the only voice'
);
select ok(
  exists (select 1 from public.ai_models where id = 'gemini-voice' and not enabled),
  'the Gemini voice row stays, turned off'
);
select is(
  public.ai_price((select x from public.ai_models x where id = 'elevenlabs-voice'), '{"prompt":"Hello there","voice":"Aria"}'),
  5, 'voice keeps its price'
);
select throws_ok(
  $$ select public.ai_check_spec((select x from public.ai_models x where id = 'elevenlabs-sfx'), '{"prompt":"a whoosh","duration":30}') $$,
  '22023', 'Sounds are 1 to 22 seconds long.', 'sound effects keep their limits'
);

select * from finish();
rollback;
