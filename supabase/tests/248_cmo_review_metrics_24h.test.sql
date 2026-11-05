-- cmo-review B2.4 (20270106040000): the sweep queues pull_metrics once a post is 24 hours old, once per post window.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(5);

insert into auth.users (id, email) values ('e2480000-0000-4000-8000-00000000000a', 'b24@test.local');
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status) values
  ('e2481000-0000-4000-8000-00000000000a', 'e2480000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date, 'post_draft', 'Posts', '{}', 'writer', 'done');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2482000-0000-4000-8000-00000000000a', 'e2480000-0000-4000-8000-00000000000a', 'post', 'x', current_date - 1, 'Post a', 'in_review', '{"text":"Post a."}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e2483000-0000-4000-8000-00000000000a', 'e2480000-0000-4000-8000-00000000000a', 'e2481000-0000-4000-8000-00000000000a', 'post', 'content_item', 'e2482000-0000-4000-8000-00000000000a', 'decided');
-- Published 23 hours ago: not yet.
insert into public.schedule_slots (id, user_id, deliverable_id, platform, mode, publish_at, window_ends_at, status, published_at) values
  ('e2484000-0000-4000-8000-00000000000a', 'e2480000-0000-4000-8000-00000000000a', 'e2483000-0000-4000-8000-00000000000a', 'x',
    'publish', now() - interval '23 hours', now() - interval '22 hours 45 minutes', 'published', now() - interval '23 hours');

select is((public.schedule_claim_due()->>'measured')::int, 0, 'a post under a day old is not measured yet');

update public.schedule_slots set publish_at = now() - interval '25 hours', window_ends_at = now() - interval '24 hours 45 minutes',
  published_at = now() - interval '25 hours' where id = 'e2484000-0000-4000-8000-00000000000a';
select is((public.schedule_claim_due()->>'measured')::int, 1, 'a day after it went out, its numbers are read');
select is((select count(*)::int from public.cmo_runs where user_id = 'e2480000-0000-4000-8000-00000000000a' and kind = 'pull_metrics'
             and status = 'queued' and input->>'source' = 'event'), 1, 'one pull_metrics run is queued');
select is((public.schedule_claim_due()->>'measured')::int, 0, 'the next sweep queues nothing again');

update public.profiles set cmo_paused_at = now() where id = 'e2480000-0000-4000-8000-00000000000a';
delete from public.cmo_runs where user_id = 'e2480000-0000-4000-8000-00000000000a' and kind = 'pull_metrics';
select is((public.schedule_claim_due()->>'measured')::int, 0, 'a paused founder is not measured');

select * from finish();
rollback;
