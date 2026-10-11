-- 20261115090000: room for a whole /video in flight, and a typical time per text-to-video model.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(3);

select is(public.generation_active_limit(), 24, 'up to 24 generations in flight per user');
select is((select (limits->>'typicalSeconds')::int from public.ai_models where id = 'fal-seedance'), 45, 'seedance typical time');
select is((select count(*)::int from public.ai_models where kind = 'video' and limits ? 'typicalSeconds'), 5, 'every text-to-video model has a typical time');

select * from finish();
rollback;
