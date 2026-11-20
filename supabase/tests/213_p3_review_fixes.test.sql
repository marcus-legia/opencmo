-- P3 review fixes (20261229100000, 20261229110000): a post's runs match by item whether or not they carry the order;
-- a Threads or LinkedIn post is marked posted with its own link and platform; a skip reason is remembered once.
-- (The video script and caption cases went with wave 4b.)
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(13);

insert into auth.users (id, email) values ('e2130000-0000-4000-8000-00000000000a', 'fixes@test.local');
update public.profiles set credit_balance = 50 where id = 'e2130000-0000-4000-8000-00000000000a';
-- P5 A2: fresh niche research, so the week plan orders none and the briefs start at once, as this test expects.
insert into public.cmo_insights (user_id, kind, body) values
  ('e2130000-0000-4000-8000-00000000000a', 'niche_video', '{}');
create temp table t (name text primary key, id uuid) on commit drop;
grant all on t to authenticated;
create function pg_temp.id(p text) returns uuid language sql as $$ select id from t where name = p $$;
create function pg_temp.balance() returns integer language sql as $$
  select credit_balance from public.profiles where id = 'e2130000-0000-4000-8000-00000000000a' $$;

-- F1: the schedule names a post's order only while it is queued; the item is the key either way.
create temp table r (name text primary key, id uuid) on commit drop;
insert into r select 'first', (public.enqueue_cmo_run_for('e2130000-0000-4000-8000-00000000000a', 'post_draft',
  '{"item_id":"e2139999-0000-4000-8000-000000000001","order_id":"e2139999-0000-4000-8000-0000000000aa"}')).id;
select is((public.enqueue_cmo_run_for('e2130000-0000-4000-8000-00000000000a', 'post_draft', '{"item_id":"e2139999-0000-4000-8000-000000000001"}')).id,
  (select id from r where name = 'first'), 'the same item without its order waits behind its run');
update public.cmo_runs set status = 'running', lease_until = now() + interval '5 minutes' where id = (select id from r where name = 'first');
select is((public.enqueue_cmo_run_for('e2130000-0000-4000-8000-00000000000a', 'post_draft', '{"item_id":"e2139999-0000-4000-8000-000000000001"}')).id,
  (select id from r where name = 'first'), 'also once it runs');
select is((select count(*)::int from public.cmo_runs where input->>'item_id' = 'e2139999-0000-4000-8000-000000000001'), 1, 'one run for the item');
select isnt((public.enqueue_cmo_run_for('e2130000-0000-4000-8000-00000000000a', 'write_caption', '{"order_id":"e2139999-0000-4000-8000-0000000000bb"}')).id,
  (public.enqueue_cmo_run_for('e2130000-0000-4000-8000-00000000000a', 'write_caption', '{"order_id":"e2139999-0000-4000-8000-0000000000cc"}')).id,
  'Writer''s orders still key by order');
update public.cmo_runs set status = 'done', finished_at = now() where user_id = 'e2130000-0000-4000-8000-00000000000a' and kind in ('post_draft', 'write_caption');

-- F5: a Threads or LinkedIn post is marked posted with its own platform's link and logged under its profile.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2134000-0000-4000-8000-000000000001', 'e2130000-0000-4000-8000-00000000000a', 'post', 'Threads', current_date, 'On Threads', 'approved', '{"text":"Hi."}'),
  ('e2134000-0000-4000-8000-000000000002', 'e2130000-0000-4000-8000-00000000000a', 'post', 'LinkedIn', current_date, 'On LinkedIn', 'approved', '{"text":"Hi."}'),
  ('e2134000-0000-4000-8000-000000000003', 'e2130000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'On X', 'approved', '{"text":"Hi."}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2130000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.cmo_mark_posted('e2134000-0000-4000-8000-000000000001', 'https://x.com/me/status/1') $$,
  '22023', 'Paste the link to your post on Threads, like https://www.threads.com/@you/post/abc.', 'a Threads post takes a Threads link');
select is((public.cmo_mark_posted('e2134000-0000-4000-8000-000000000001', 'https://www.threads.com/@me/post/DAbc_12-x')).status,
  'published', 'and is marked posted with it');
select throws_ok($$ select public.cmo_mark_posted('e2134000-0000-4000-8000-000000000002', 'https://www.threads.com/@me/post/abc') $$,
  '22023', 'Paste the link to your post on LinkedIn, like https://www.linkedin.com/feed/update/urn:li:activity:123.',
  'a LinkedIn post takes a LinkedIn link');
select is((public.cmo_mark_posted('e2134000-0000-4000-8000-000000000002', 'https://www.linkedin.com/feed/update/urn:li:activity:7123456789')).status,
  'published', 'and is marked posted with it');
select throws_ok($$ select public.cmo_mark_posted('e2134000-0000-4000-8000-000000000003', 'https://www.threads.com/@me/post/abc') $$,
  '22023', 'Paste the link to your post on X, like https://x.com/you/status/123.', 'an X post still takes an X link');
select is((public.cmo_mark_posted('e2134000-0000-4000-8000-000000000003')).status, 'published', 'a link stays optional');
reset role;
select is((select array_agg(platform order by platform) from public.operation_log
  where user_id = 'e2130000-0000-4000-8000-00000000000a' and action = 'publish'), array['linkedin', 'threads', 'x'],
  'each publish is logged under its own platform');

-- F9: with no decision to learn from, the skip reason is still remembered once, as feedback.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2134000-0000-4000-8000-000000000004', 'e2130000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Pricing', 'in_review', '{"text":"Hi."}');
insert into public.cmo_draft_outcomes (user_id, item_id, department, action)
values ('e2130000-0000-4000-8000-00000000000a', 'e2134000-0000-4000-8000-000000000004', 'post', 'approve');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2130000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((public.cmo_decide_post('e2134000-0000-4000-8000-000000000004', 'skip', null, 'Too pushy')).status, 'skipped', 'skipped');
reset role;
select is((select array_agg(type) from public.cmo_memories where body like '%Too pushy%'), array['feedback'],
  'its reason is one feedback memory when no voice note could be written');

select * from finish();
rollback;
