-- 3.4 (20270114040000): product_events records the funnel once per thing, from triggers; founders can neither read
-- nor write it; the activation view counts a seeded example.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(14);

insert into auth.users (id, email) values
  ('e2890000-0000-4000-8000-00000000000a', 'pe-a@test.local'),
  ('e2890000-0000-4000-8000-00000000000b', 'pe-b@test.local');
update public.profiles set plan = 'starter' where id = 'e2890000-0000-4000-8000-00000000000a';

-- onboarded: once, however often the run ends.
insert into public.cmo_runs (id, user_id, kind, status, input) values
  ('e2891000-0000-4000-8000-00000000000a', 'e2890000-0000-4000-8000-00000000000a', 'onboard', 'running', '{}'),
  ('e2891000-0000-4000-8000-00000000000b', 'e2890000-0000-4000-8000-00000000000a', 'onboard', 'running', '{}');
update public.cmo_runs set status = 'done' where id = 'e2891000-0000-4000-8000-00000000000a';
update public.cmo_runs set status = 'done' where id = 'e2891000-0000-4000-8000-00000000000b';
select is((select count(*)::int from public.product_events where kind = 'onboarded'), 1, 'onboarded: once per account');

-- approve: through the real decision, once; the post's platform and the account's plan are kept.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2892000-0000-4000-8000-00000000000a', 'e2890000-0000-4000-8000-00000000000a', 'post', 'X', current_date, 'A post', 'in_review',
   '{"text":"A post","alternates":[]}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2890000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.approval_decide((select id from public.approvals where kind = 'post'), 'approve',
  jsonb_build_object('content_hash', (select content_hash from public.approvals where kind = 'post'), 'via', 'app')) $$, 'the founder approves');
reset role;
update public.approvals set status = 'approved' where kind = 'post' and user_id = 'e2890000-0000-4000-8000-00000000000a';
select is((select kind || ' ' || platform || ' ' || paid from public.product_events where kind = 'approve'), 'approve x true',
  'approve: once, with its platform and plan');

-- posted: the post published ("I posted it" or OpenCMO), once.
update public.content_items set status = 'published', published_at = now() where id = 'e2892000-0000-4000-8000-00000000000a';
update public.content_items set status = 'approved' where id = 'e2892000-0000-4000-8000-00000000000a';
update public.content_items set status = 'published' where id = 'e2892000-0000-4000-8000-00000000000a';
select is((select count(*)::int from public.product_events where kind = 'posted'), 1, 'posted: once per post');

-- schedule: a slot made waiting, once; a short's slot published counts as posted, a post's slot does not twice.
insert into public.work_orders (id, user_id, week, department, kind, title) values
  ('e2893000-0000-4000-8000-00000000000a', 'e2890000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date, 'schedule', 'schedule', 'Slots');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id) values
  ('e2894000-0000-4000-8000-00000000000a', 'e2890000-0000-4000-8000-00000000000a', 'e2893000-0000-4000-8000-00000000000a', 'post', 'content_item', 'e2892000-0000-4000-8000-00000000000a'),
  ('e2894000-0000-4000-8000-00000000000b', 'e2890000-0000-4000-8000-00000000000a', 'e2893000-0000-4000-8000-00000000000a', 'short', 'clip', gen_random_uuid());
insert into public.schedule_slots (id, user_id, deliverable_id, platform, publish_at, window_ends_at, status) values
  ('e2895000-0000-4000-8000-00000000000a', 'e2890000-0000-4000-8000-00000000000a', 'e2894000-0000-4000-8000-00000000000a', 'x', now() + interval '1 day', now() + interval '2 days', 'proposed'),
  ('e2895000-0000-4000-8000-00000000000b', 'e2890000-0000-4000-8000-00000000000a', 'e2894000-0000-4000-8000-00000000000b', 'tiktok', now() + interval '1 day', now() + interval '2 days', 'waiting');
update public.schedule_slots set status = 'waiting' where id = 'e2895000-0000-4000-8000-00000000000a';
update public.schedule_slots set status = 'proposed' where id = 'e2895000-0000-4000-8000-00000000000a';
update public.schedule_slots set status = 'waiting' where id = 'e2895000-0000-4000-8000-00000000000a';
select is((select count(*)::int from public.product_events where kind = 'schedule'), 2, 'schedule: once per slot, inserted or updated');
update public.schedule_slots set status = 'published' where user_id = 'e2890000-0000-4000-8000-00000000000a';
select is((select string_agg(platform, ',' order by platform) from public.product_events where kind = 'posted'), 'tiktok,x',
  'posted: the short from its slot, the post only once');

-- reply_copied: a Sales thread marked replied, once.
insert into public.opportunities (id, user_id, platform, url, title, score, reply, rule, status) values
  ('e2896000-0000-4000-8000-00000000000a', 'e2890000-0000-4000-8000-00000000000a', 'reddit', 'https://reddit.com/r/x/1', 'A thread', 80, 'A reply', 'help_only', 'in_review');
update public.opportunities set status = 'replied' where id = 'e2896000-0000-4000-8000-00000000000a';
update public.opportunities set status = 'in_review' where id = 'e2896000-0000-4000-8000-00000000000a';
update public.opportunities set status = 'replied' where id = 'e2896000-0000-4000-8000-00000000000a';
select is((select count(*)::int from public.product_events where kind = 'reply_copied'), 1, 'reply_copied: once per thread');

-- Founders can neither read nor write it, nor the view.
select ok(not has_table_privilege('authenticated', 'public.product_events', 'select'), 'founders cannot read events');
select ok(not has_table_privilege('authenticated', 'public.product_events', 'insert'), 'founders cannot write events');
select ok(not has_table_privilege('anon', 'public.product_events', 'select'), 'anon cannot read events');
select ok(not has_table_privilege('authenticated', 'public.activation', 'select'), 'founders cannot read the view');
select ok(has_table_privilege('service_role', 'public.activation', 'select'), 'the service role reads the view');

-- The view: A onboarded and approved within 24 h; B onboarded and never approved.
insert into public.product_events (user_id, kind, paid, ref_id, at) values
  ('e2890000-0000-4000-8000-00000000000b', 'onboarded', false, 'e2890000-0000-4000-8000-00000000000b', now());
select is((select approved_24h || '/' || onboarded || ' ' || approved_24h_pct from public.activation
  where signup_day = current_date and paid), '1/1 100.0', 'paid: one of one approved within 24 h');
select is((select approved_24h || '/' || onboarded from public.activation where signup_day = current_date and not paid
  and onboarded > 0), '0/1', 'unpaid: none of one');

select * from finish();
rollback;
