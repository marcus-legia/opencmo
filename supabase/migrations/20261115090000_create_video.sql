-- /video in the editor Assistant creates every shot of a video at once (text-to-video in parallel,
-- plus the voice-over and music), so a 60-second video waits for the slowest shot, not the sum.
-- That needs more than 6 generations in flight per user. Credits are still held per generation
-- and the approval card shows the total, so the cap only guards against runaway load.
--
-- `typicalSeconds`: about how long one shot takes on each text-to-video model (the provider's
-- published speed, not a guarantee); the card shows it and /video picks the fastest model.
-- Same values as packages/contracts/ai-models.json.

begin;

create or replace function public.generation_active_limit()
returns int language sql immutable set search_path = public as $$ select 24 $$;

update public.ai_models set limits = limits || '{"typicalSeconds":10}'::jsonb where id = 'fake-video';
update public.ai_models set limits = limits || '{"typicalSeconds":45}'::jsonb where id = 'fal-seedance';
update public.ai_models set limits = limits || '{"typicalSeconds":60}'::jsonb where id = 'gemini-video';
update public.ai_models set limits = limits || '{"typicalSeconds":120}'::jsonb where id = 'fal-hailuo';
update public.ai_models set limits = limits || '{"typicalSeconds":180}'::jsonb where id = 'fal-kling';

commit;
