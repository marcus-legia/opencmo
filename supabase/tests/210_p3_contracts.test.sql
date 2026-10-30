-- P3 A0 (20261229090000): platform_profile() mirrors platforms.json; an outcome gets its post's platform; one voice
-- note per decision; a caption belongs to a video or short of the same founder.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(23);

select is(public.platform_profile('threads')->>'limit', '500', 'Threads: 500 characters');
select is(public.platform_profile('linkedin')->>'hashtags', '0', 'no hashtags in posts');
select is(public.platform_profile('youtube')->>'title', '100', 'a YouTube title has its own limit');
select is(public.platform_profile('reddit'), null, 'a platform without a profile has none');

insert into auth.users (id, email) values
  ('e2100000-0000-4000-8000-00000000000a', 'p3a0@test.local'),
  ('e2100000-0000-4000-8000-00000000000b', 'p3a0-other@test.local');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2101000-0000-4000-8000-00000000000a', 'e2100000-0000-4000-8000-00000000000a', 'post', 'threads', current_date, 'Threads idea', 'approved', '{"text":"t"}'),
  ('e2101000-0000-4000-8000-00000000000b', 'e2100000-0000-4000-8000-00000000000a', 'post', 'mastodon', current_date, 'Odd platform', 'approved', '{"text":"t"}');

-- Outcomes per platform.
insert into public.cmo_draft_outcomes (id, user_id, item_id, department, action) values
  ('e2102000-0000-4000-8000-00000000000a', 'e2100000-0000-4000-8000-00000000000a', 'e2101000-0000-4000-8000-00000000000a', 'post', 'approve'),
  ('e2102000-0000-4000-8000-00000000000b', 'e2100000-0000-4000-8000-00000000000a', 'e2101000-0000-4000-8000-00000000000b', 'post', 'approve');
select is((select platform from public.cmo_draft_outcomes where id = 'e2102000-0000-4000-8000-00000000000a'), 'threads',
  'an outcome takes its post''s platform');
select is((select platform from public.cmo_draft_outcomes where id = 'e2102000-0000-4000-8000-00000000000b'), null,
  'a platform without a profile stays empty rather than failing the decision');
select throws_ok($$ update public.cmo_draft_outcomes set platform = 'myspace' where id = 'e2102000-0000-4000-8000-00000000000a' $$,
  '23514', null, 'only profile ids are stored');

-- One voice note per decision, read newest first.
insert into public.cmo_memories (user_id, type, body, kind, topic, source_outcome) values
  ('e2100000-0000-4000-8000-00000000000a', 'agent', 'Short sentences, one idea each.', 'preference', 'post', 'e2102000-0000-4000-8000-00000000000a');
select throws_ok($$ insert into public.cmo_memories (user_id, type, body, kind, topic, source_outcome) values
  ('e2100000-0000-4000-8000-00000000000a', 'agent', 'Again', 'preference', 'post', 'e2102000-0000-4000-8000-00000000000a') $$,
  '23505', null, 'a decision gives at most one note');
select ok(exists (select 1 from pg_indexes where indexname = 'cmo_memories_voice_idx'), 'voice notes have their newest-first index');
delete from public.cmo_draft_outcomes where id = 'e2102000-0000-4000-8000-00000000000a';
select is((select count(*)::int from public.cmo_memories where body = 'Short sentences, one idea each.' and source_outcome is null), 1,
  'a note outlives the outcome it came from');

-- Captions.
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e2103000-0000-4000-8000-00000000000a', 'e2100000-0000-4000-8000-00000000000a', 'https://a', 60, 'done');
insert into public.clips (id, job_id, idx, hook, start_seconds, end_seconds, kind) values
  ('e2104000-0000-4000-8000-00000000000a', 'e2103000-0000-4000-8000-00000000000a', -1, 'Launch', 0, 0, 'blank');
select throws_ok($$ insert into public.content_items (user_id, department, platform, day, idea, clip_id) values
  ('e2100000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'A post', 'e2104000-0000-4000-8000-00000000000a') $$,
  '23514', null, 'only a video''s words point at an edit');
insert into public.content_items (id, user_id, department, platform, day, idea, status, clip_id, body) values
  ('e2101000-0000-4000-8000-00000000000c', 'e2100000-0000-4000-8000-00000000000a', 'video', 'tiktok_caption', current_date,
   'Caption', 'drafting', 'e2104000-0000-4000-8000-00000000000a', '{"text":"Cut by words #editing"}');
select is((select count(*)::int from public.approvals where ref_id = 'e2101000-0000-4000-8000-00000000000c'), 0,
  'a caption is not a card of its own');

insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e2105000-0000-4000-8000-00000000000a', 'e2100000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'build_video', 'Video', '{"objective":"v"}', 'studio', 'running');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id) values
  ('e2106000-0000-4000-8000-00000000000a', 'e2100000-0000-4000-8000-00000000000a', 'e2105000-0000-4000-8000-00000000000a', 'video', 'clip', 'e2104000-0000-4000-8000-00000000000a');
create temp table t_cap (id uuid) on commit drop;
-- The video's deliverable brings its captions' along (A2's rule, 20261229110000).
create function pg_temp.cap() returns uuid language sql as $$
  select id from public.deliverables where ref_kind = 'content_item' and ref_id = 'e2101000-0000-4000-8000-00000000000c' $$;
select is((select parent_id from public.deliverables where id = pg_temp.cap()),
  'e2106000-0000-4000-8000-00000000000a'::uuid, 'a caption points at its video');
select throws_ok($$ update public.deliverables set parent_id = 'e2106000-0000-4000-8000-00000000000a'
  where id = 'e2106000-0000-4000-8000-00000000000a' $$, '23514', null, 'only a caption has a parent');
select throws_ok($$ insert into public.deliverables (user_id, order_id, kind, ref_kind, ref_id, parent_id) values
  ('e2100000-0000-4000-8000-00000000000a', 'e2105000-0000-4000-8000-00000000000a', 'caption', 'content_item', gen_random_uuid(),
   pg_temp.cap()) $$, '23514', 'A caption belongs to one of your videos or shorts.', 'a caption''s parent is a video or short');
select throws_ok($$ update public.deliverables set user_id = 'e2100000-0000-4000-8000-00000000000b'
  where id = pg_temp.cap() $$, '23514', 'A caption belongs to one of your videos or shorts.',
  'and belongs to the same founder');
insert into t_cap select pg_temp.cap();
delete from public.deliverables where id = 'e2106000-0000-4000-8000-00000000000a';
select is((select count(*)::int from public.deliverables where id = (select id from t_cap)), 0,
  'a caption goes with its video');
delete from public.clips where id = 'e2104000-0000-4000-8000-00000000000a';
select is((select count(*)::int from public.content_items where id = 'e2101000-0000-4000-8000-00000000000c'), 0,
  'and with its edit');

-- The founder reads the new columns through the grants the tables already have.
select ok(has_column_privilege('authenticated', 'public.cmo_draft_outcomes', 'platform', 'select'), 'outcome platform readable');
select ok(has_column_privilege('authenticated', 'public.cmo_memories', 'source_outcome', 'select'), 'note source readable');
select ok(has_column_privilege('authenticated', 'public.deliverables', 'parent_id', 'select'), 'caption parent readable');
select ok(not has_function_privilege('authenticated', 'public.deliverables_parent_guard()', 'execute'), 'the guard is not callable');
select ok(not has_function_privilege('authenticated', 'public.platform_profile(text)', 'execute'), 'nor the profile lookup');

select * from finish();
rollback;
