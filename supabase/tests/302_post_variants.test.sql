-- 20270120040000: "Rewrite for <platform>" holds its price and queues one run; the rewrite is that platform's
-- variant, its slot posts it and the other platforms keep the core text; an edited post ignores a stale variant; a slot
-- already approved goes back to the founder; nobody else reads or orders it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(24);

select ok(has_function_privilege('authenticated', 'public.repurpose_post(uuid,text)', 'execute'), 'a founder can ask for a rewrite');
select ok(not has_function_privilege('anon', 'public.repurpose_post(uuid,text)', 'execute'), 'anon cannot');
select ok(not has_function_privilege('authenticated', 'public.cmo_save_variant(uuid,uuid,uuid,text,text,jsonb)', 'execute'), 'only the runner saves a rewrite');
select ok(has_table_privilege('authenticated', 'public.post_variants', 'select')
  and not has_table_privilege('authenticated', 'public.post_variants', 'insert, update, delete'), 'a founder reads variants and writes none');
select ok(not has_table_privilege('anon', 'public.post_variants', 'select'), 'anon reads none');

insert into auth.users (id, email) values
  ('e3020000-0000-4000-8000-00000000000a', 'variant-a@test.local'),
  ('e3020000-0000-4000-8000-00000000000b', 'variant-b@test.local');
update public.profiles set plan = 'starter', credit_balance = 10, timezone = 'UTC' where id::text like 'e3020000-%';

insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e3021000-0000-4000-8000-00000000000a', 'e3020000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'done');
-- One core post for X and LinkedIn, waiting on its card.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e3022000-0000-4000-8000-00000000000a', 'e3020000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'Core', 'in_review',
   '{"text":"The core post, as written.","targets":["x","linkedin"]}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status)
values ('e3023000-0000-4000-8000-00000000000a', 'e3020000-0000-4000-8000-00000000000a', 'e3021000-0000-4000-8000-00000000000a', 'post',
  'content_item', 'e3022000-0000-4000-8000-00000000000a', 'waiting_founder');

create temp table t_run (result jsonb) on commit drop;
grant all on t_run to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3020000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok($$ select public.repurpose_post('e3022000-0000-4000-8000-00000000000a', 'linkedin') $$, 'P0002', 'Post not found.',
  'another founder''s post is not found');
set local request.jwt.claims = '{"sub":"e3020000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.repurpose_post('e3022000-0000-4000-8000-00000000000a', 'threads') $$, '22023',
  'This post does not go to that platform.', 'only a platform the post goes to');
select throws_ok($$ select public.repurpose_post('e3022000-0000-4000-8000-00000000000a', 'tiktok_caption') $$, '22023',
  'This post does not go to that platform.', 'a caption profile is not a post platform');
select throws_ok($$ select public.enqueue_cmo_run('repurpose_post', '{"item_id":"e3022000-0000-4000-8000-00000000000a","platform":"linkedin"}') $$,
  '22023', 'Unknown task.', 'the general queue refuses it');
insert into t_run select public.repurpose_post('e3022000-0000-4000-8000-00000000000a', 'linkedin');
insert into t_run select public.repurpose_post('e3022000-0000-4000-8000-00000000000a', 'linkedin');
reset role;

select is((select count(distinct result->>'run_id')::int from t_run), 1, 'a second press is the same run');
select is((select kind || ' ' || status from public.cmo_runs where id = (select (result->>'run_id')::uuid from t_run limit 1)),
  'repurpose_post queued', 'one rewrite is queued');
select is((select -sum(delta)::int from public.credit_ledger where user_id = 'e3020000-0000-4000-8000-00000000000a'
  and ref_kind = 'cmo_run' and ref_id = (select (result->>'run_id')::uuid from t_run limit 1)), 1, 'one credit is held, once');

-- The runner saves the rewrite.
select throws_ok($$ select public.cmo_save_variant('e3020000-0000-4000-8000-00000000000a', (select (result->>'run_id')::uuid from t_run limit 1),
  'e3022000-0000-4000-8000-00000000000a', 'linkedin', repeat('x', 3001)) $$, '22023', 'The rewrite must be between 1 and 3000 characters.',
  'a rewrite over the platform''s limit is refused');
select throws_ok($$ select public.cmo_save_variant('e3020000-0000-4000-8000-00000000000b', (select (result->>'run_id')::uuid from t_run limit 1),
  'e3022000-0000-4000-8000-00000000000a', 'linkedin', 'Not theirs.') $$, 'P0002', 'Run not found.', 'a run saves only for its own founder');
select lives_ok($$ select public.cmo_save_variant('e3020000-0000-4000-8000-00000000000a', (select (result->>'run_id')::uuid from t_run limit 1),
  'e3022000-0000-4000-8000-00000000000a', 'linkedin', 'The LinkedIn version, with more room.') $$, 'the rewrite is saved');

select is(public.schedule_content('e3023000-0000-4000-8000-00000000000a', 'linkedin')->>'text', 'The LinkedIn version, with more room.',
  'LinkedIn posts the rewrite');
select is(public.schedule_content('e3023000-0000-4000-8000-00000000000a', 'x')->>'text', 'The core post, as written.', 'X keeps the core post');
select isnt(public.schedule_content('e3023000-0000-4000-8000-00000000000a', 'linkedin')->>'content_hash',
  public.schedule_content('e3023000-0000-4000-8000-00000000000a', 'x')->>'content_hash', 'the two are approved apart');

-- A slot the founder already approved goes back to them when a new rewrite lands.
insert into public.schedule_slots (id, user_id, deliverable_id, platform, mode, publish_at, jitter_seconds, window_ends_at, options, status)
values ('e3024000-0000-4000-8000-00000000000a', 'e3020000-0000-4000-8000-00000000000a', 'e3023000-0000-4000-8000-00000000000a', 'linkedin',
  'intent', now() + interval '2 days', 0, now() + interval '2 days 30 minutes', '{}', 'waiting'),
  ('e3024000-0000-4000-8000-00000000000b', 'e3020000-0000-4000-8000-00000000000a', 'e3023000-0000-4000-8000-00000000000a', 'x',
  'intent', now() + interval '2 days', 0, now() + interval '2 days 30 minutes', '{}', 'waiting');
select public.cmo_save_variant('e3020000-0000-4000-8000-00000000000a', (select (result->>'run_id')::uuid from t_run limit 1),
  'e3022000-0000-4000-8000-00000000000a', 'linkedin', 'A second LinkedIn version.');
select is((select count(*)::int from public.post_variants where item_id = 'e3022000-0000-4000-8000-00000000000a'), 1, 'a new rewrite replaces the old one');
select is((select status from public.schedule_slots where id = 'e3024000-0000-4000-8000-00000000000a'), 'proposed', 'the LinkedIn slot waits for the founder again');
select is((select snapshot->>'text' from public.approvals where ref_kind = 'schedule_slot' and ref_id = 'e3024000-0000-4000-8000-00000000000a' and status = 'waiting'),
  'A second LinkedIn version.', 'its card shows the rewrite');
select is((select status from public.schedule_slots where id = 'e3024000-0000-4000-8000-00000000000b'), 'waiting', 'the X slot is left alone');

-- The founder edits the post: the rewrite was written from other words, so the core text goes out everywhere.
update public.content_items set body = jsonb_set(body, '{text}', '"The core post, edited."') where id = 'e3022000-0000-4000-8000-00000000000a';
select is(public.schedule_content('e3023000-0000-4000-8000-00000000000a', 'linkedin')->>'text', 'The core post, edited.',
  'a rewrite of the old words is not posted');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e3020000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is((select count(*)::int from public.post_variants), 0, 'another founder reads no variant');
reset role;

select * from finish();
rollback;
