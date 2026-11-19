-- Wave 3 (20270201060000): re-reads include Threads and use the pasted reply link; nudges due are the founder's own
-- replied people after 4 days with no nudge; a post's Library sources are cleaned on the plan and kept by the draft.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(12);

insert into auth.users (id, email) values
  ('e3430000-0000-4000-8000-00000000000a', 'fps-a@test.local'),
  ('e3430000-0000-4000-8000-00000000000b', 'fps-b@test.local');
insert into public.cmo_runs (id, user_id, kind, status, input, credits) values
  ('e3430000-0000-4000-8000-0000000000a0', 'e3430000-0000-4000-8000-00000000000a', 'plan_week', 'running', '{}', 0);
insert into public.opportunities (id, user_id, platform, url, community, title, score, reply, status, person_status, replied_at, reply_url) values
  ('e3430000-0000-4000-8000-0000000000c1', 'e3430000-0000-4000-8000-00000000000a', 'threads',
   'https://www.threads.com/@sam/post/abc', '', 'Threads', 70, 'Reply.', 'replied', 'replied', now() - interval '5 days',
   'https://www.threads.com/@me/post/def'),
  ('e3430000-0000-4000-8000-0000000000c2', 'e3430000-0000-4000-8000-00000000000a', 'reddit',
   'https://www.reddit.com/r/a/comments/2/x/', 'a', 'Recent', 70, 'Reply.', 'replied', 'replied', now() - interval '1 day', null),
  ('e3430000-0000-4000-8000-0000000000c3', 'e3430000-0000-4000-8000-00000000000a', 'reddit',
   'https://www.reddit.com/r/a/comments/3/x/', 'a', 'Answered', 70, 'Reply.', 'replied', 'answered_back', now() - interval '9 days', null),
  ('e3430000-0000-4000-8000-0000000000d1', 'e3430000-0000-4000-8000-00000000000b', 'reddit',
   'https://www.reddit.com/r/b/comments/1/x/', 'b', 'B', 70, 'Reply.', 'replied', 'replied', now() - interval '9 days', null);
insert into public.cmo_draft_outcomes (user_id, item_id, department, action, decided_at, outcome_url) values
  ('e3430000-0000-4000-8000-00000000000a', 'e3430000-0000-4000-8000-0000000000c1', 'sales', 'replied', now() - interval '5 days', 'https://old.example/link');

-- B6.
select is((select platform || ' ' || outcome_url from public.cmo_reply_outcomes_due('e3430000-0000-4000-8000-00000000000a', 10)),
  'threads https://www.threads.com/@me/post/def', 'a Threads reply is due, read from the pasted link');

-- B2.
select ok(not has_function_privilege('authenticated', 'public.cmo_nudges_due(uuid, integer)', 'execute'), 'founders cannot call it');
select is((select string_agg(title, ', ') from public.cmo_nudges_due('e3430000-0000-4000-8000-00000000000a')), 'Threads',
  'only replied people after 4 days, not answered back, not another founder''s');
update public.opportunities set nudge_draft = 'Any luck?' where id = 'e3430000-0000-4000-8000-0000000000c1';
select is((select count(*)::integer from public.cmo_nudges_due('e3430000-0000-4000-8000-00000000000a')), 0, 'a drafted nudge is not due again');

-- B3: the plan keeps clean sources.
select is(public.cmo_plan_week('e3430000-0000-4000-8000-00000000000a', 'e3430000-0000-4000-8000-0000000000a0', jsonb_build_array(
  jsonb_build_object('department', 'post', 'platform', 'X', 'day', current_date, 'idea', 'Late invoices', 'targets', '["x"]'::jsonb,
    'sources', jsonb_build_array(
      jsonb_build_object('opportunityId', 'e3430000-0000-4000-8000-0000000000c2', 'summary', ' Chases invoices by hand ', 'platform', 'reddit', 'community', 'a'),
      jsonb_build_object('opportunityId', 'e3430000-0000-4000-8000-0000000000d1', 'summary', 'Not theirs', 'platform', 'reddit', 'community', 'b'),
      jsonb_build_object('opportunityId', 'e3430000-0000-4000-8000-0000000000c3', 'summary', '', 'platform', 'reddit'),
      jsonb_build_object('opportunityId', 'e3430000-0000-4000-8000-0000000000c3', 'summary', 'Bad platform', 'platform', 'tiktok'))),
  jsonb_build_object('department', 'post', 'platform', 'X', 'day', current_date, 'idea', 'No sources', 'targets', '["x"]'::jsonb)
)), 2, 'two planned posts');
select is((select body->'sources' from public.content_items where user_id = 'e3430000-0000-4000-8000-00000000000a' and idea = 'Late invoices'),
  '[{"opportunityId": "e3430000-0000-4000-8000-0000000000c2", "summary": "Chases invoices by hand", "platform": "reddit", "community": "a"}]'::jsonb,
  'only the founder''s own valid source is kept, trimmed');
select ok((select not (body ? 'sources') from public.content_items where user_id = 'e3430000-0000-4000-8000-00000000000a' and idea = 'No sources'),
  'a post with none has no sources key');
select is((select body->'targets' from public.content_items where user_id = 'e3430000-0000-4000-8000-00000000000a' and idea = 'Late invoices'),
  '["x"]'::jsonb, 'targets are kept as before');

-- B3: the draft keeps the plan's sources when it sends none, and takes its own when it does.
select is((select body->'sources'->0->>'summary' from public.cmo_save_draft('e3430000-0000-4000-8000-00000000000a', 'e3430000-0000-4000-8000-0000000000a0',
  (select id from public.content_items where idea = 'Late invoices' and user_id = 'e3430000-0000-4000-8000-00000000000a'), 'Late invoices',
  '{"text": "Chasing invoices is the worst part of freelancing."}')), 'Chases invoices by hand', 'the draft keeps the plan''s sources');
select is((select body->'sources'->0->>'summary' from public.cmo_save_draft('e3430000-0000-4000-8000-00000000000a', 'e3430000-0000-4000-8000-0000000000a0',
  (select id from public.content_items where idea = 'No sources' and user_id = 'e3430000-0000-4000-8000-00000000000a'), 'No sources',
  jsonb_build_object('text', 'A post.', 'sources', jsonb_build_array(jsonb_build_object('opportunityId', 'e3430000-0000-4000-8000-0000000000c3',
    'summary', 'Answered fast', 'platform', 'reddit', 'community', 'a'))))), 'Answered fast', 'a draft''s own sources are kept');
select is((select jsonb_array_length(body->'sources') from public.cmo_save_draft('e3430000-0000-4000-8000-00000000000a', 'e3430000-0000-4000-8000-0000000000a0',
  null, 'Brief', jsonb_build_object('text', 'From a brief.', 'sources', (select jsonb_agg(jsonb_build_object('opportunityId', 'e3430000-0000-4000-8000-0000000000c2',
    'summary', 'Line ' || g, 'platform', 'reddit', 'community', 'a')) from generate_series(1, 7) g)))), 5, 'at most five sources');
select ok((select not (body ? 'sources') from public.cmo_save_draft('e3430000-0000-4000-8000-00000000000a', 'e3430000-0000-4000-8000-0000000000a0',
  null, 'Brief 2', '{"text": "No sources.", "sources": "junk"}')), 'junk sources are dropped');

select * from finish();
rollback;
