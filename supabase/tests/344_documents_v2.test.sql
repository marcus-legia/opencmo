-- Wave 3 A4 (20270201070000): documents v2. An old Content Strategy becomes a Post plan in place with its text under
-- `legacy`; every founder with a Strategy gets a Brand from its newest voice and words to avoid, without a voice event;
-- old Strategy versions stay readable; a rerun is a no-op; the RPC saves the new kinds and refuses the old one; the
-- voice history and its Undo follow the Brand; onboarding answers set the Post plan's channels.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(16);

insert into auth.users (id, email) values
  ('e3440000-0000-4000-8000-00000000000a', 'doc-a@test.local'),
  ('e3440000-0000-4000-8000-00000000000b', 'doc-b@test.local');
update public.profiles set post_platforms = array['threads', 'x'] where id = 'e3440000-0000-4000-8000-00000000000a';

-- The old state, as production holds it.
insert into public.marketing_documents (user_id, kind, version, body, created_by) values
  ('e3440000-0000-4000-8000-00000000000a', 'strategy', 1, '{"icp": "Freelancers", "voice": "Old voice", "avoid": ["synergy"]}', 'agent'),
  ('e3440000-0000-4000-8000-00000000000a', 'strategy', 2, '{"icp": "Freelancers", "voice": "Plain and dry", "avoid": ["revolutionary"]}', 'user'),
  ('e3440000-0000-4000-8000-00000000000a', 'content_strategy', 1,
   '{"pillars": [{"name": "Getting paid", "why": "Core pain", "ideas": ["3-7-14"]}, {"name": " ", "ideas": []}], "x": "Daily", "cadence": "One post a day."}', 'agent'),
  ('e3440000-0000-4000-8000-00000000000b', 'product', 1, '{"name": "B"}', 'agent');
select set_config('test.events_before', (select count(*)::text from public.cmo_voice_events where user_id = 'e3440000-0000-4000-8000-00000000000a'), true);

select is(public.documents_v2_migrate(), 2, 'one Post plan moved, one Brand written');
select is(public.documents_v2_migrate(), 0, 'a rerun is a no-op');

select is((select body - 'legacy' from public.marketing_documents where user_id = 'e3440000-0000-4000-8000-00000000000a' and kind = 'post_plan'),
  '{"topics": ["Getting paid"], "channels": ["x", "threads"], "rhythm": "One post a day."}'::jsonb,
  'pillar names become topics, the onboarding platforms the channels, the cadence the rhythm');
select is((select body->'legacy'->>'x' from public.marketing_documents where user_id = 'e3440000-0000-4000-8000-00000000000a' and kind = 'post_plan'),
  'Daily', 'the old text is kept under legacy');
select is((select count(*)::integer from public.marketing_documents where kind = 'content_strategy'), 0, 'no Content Strategy row is left');
select is((select body->>'voice' || ' / ' || (body->'avoid'->>0) || ' / ' || created_by from public.marketing_documents
  where user_id = 'e3440000-0000-4000-8000-00000000000a' and kind = 'brand'), 'Plain and dry / revolutionary / user',
  'the Brand takes the newest Strategy''s voice and words, and who wrote them');
select ok((select body ? 'look' and body ? 'voice_samples' and body ? 'intro_line' from public.marketing_documents
  where user_id = 'e3440000-0000-4000-8000-00000000000a' and kind = 'brand'), 'the Brand has every field');
select is((select count(*)::text from public.cmo_voice_events where user_id = 'e3440000-0000-4000-8000-00000000000a'),
  current_setting('test.events_before'), 'moving the voice is not a voice event');
select is((select body->>'voice' from public.marketing_documents where user_id = 'e3440000-0000-4000-8000-00000000000a' and kind = 'strategy' and version = 1),
  'Old voice', 'old Strategy versions stay readable as they were');
select ok(not exists (select 1 from public.marketing_documents where user_id = 'e3440000-0000-4000-8000-00000000000b' and kind = 'brand'),
  'no Strategy, no Brand');

-- The founder saves the new kinds; the old one is refused.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3440000-0000-4000-8000-00000000000a"}';
select is((select version from public.save_marketing_document('brand', '{"voice": "Plain, dry, a bit funny", "avoid": ["revolutionary"]}')), 2,
  'a Brand edit is the next version');
select throws_ok($$ select public.save_marketing_document('content_strategy', '{}') $$, '22023', 'Unknown document.', 'Content Strategy is gone');
select is((select field || ':' || source from public.cmo_voice_events where user_id = 'e3440000-0000-4000-8000-00000000000a' order by seq desc limit 1),
  'voice:you', 'a Brand voice edit is in the voice history');
select is((select field from public.cmo_voice_undo((select id from public.cmo_voice_events where user_id = 'e3440000-0000-4000-8000-00000000000a' order by seq desc limit 1))),
  'voice', 'Undo works on the Brand');
select is((select body->>'voice' from public.marketing_documents where user_id = 'e3440000-0000-4000-8000-00000000000a' and kind = 'brand' order by version desc limit 1),
  'Plain and dry', 'and puts the earlier voice back');

reset role;
update public.profiles set post_platforms = array['linkedin'] where id = 'e3440000-0000-4000-8000-00000000000a';
select public.cmo_apply_onboarding_answers('e3440000-0000-4000-8000-00000000000a');
select is((select body->'channels' from public.marketing_documents where user_id = 'e3440000-0000-4000-8000-00000000000a' and kind = 'post_plan' order by version desc limit 1),
  '["linkedin"]'::jsonb, 'the onboarding answer sets the Post plan''s channels');

select * from finish();
rollback;
