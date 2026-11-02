-- P4 A3 (20261230110000): an approved post and an approved short get their slots and cards by themselves; a post
-- marked posted by hand drops what still waits.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(8);

insert into auth.users (id, email) values ('e2170000-0000-4000-8000-00000000000a', 'p4a3@test.local');
update public.profiles set timezone = 'Asia/Ho_Chi_Minh' where id = 'e2170000-0000-4000-8000-00000000000a';
insert into public.work_orders (id, user_id, week, kind, title, brief, department, status)
values ('e2171000-0000-4000-8000-00000000000a', 'e2170000-0000-4000-8000-00000000000a', date_trunc('week', current_date)::date,
  'post_draft', 'Posts', '{}', 'writer', 'waiting_founder');

-- A post: its deliverable waits, then the founder approves the post.
insert into public.content_items (id, user_id, department, platform, day, idea, status, body) values
  ('e2172000-0000-4000-8000-00000000000a', 'e2170000-0000-4000-8000-00000000000a', 'post', 'linkedin', current_date, 'Why',
   'in_review', '{"text":"Why we built the editor first."}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e2173000-0000-4000-8000-00000000000a', 'e2170000-0000-4000-8000-00000000000a', 'e2171000-0000-4000-8000-00000000000a',
   'post', 'content_item', 'e2172000-0000-4000-8000-00000000000a', 'waiting_founder');
select is((select count(*)::int from public.schedule_slots where deliverable_id = 'e2173000-0000-4000-8000-00000000000a'), 0,
  'nothing is scheduled while the post waits');
update public.content_items set status = 'approved' where id = 'e2172000-0000-4000-8000-00000000000a';
update public.deliverables set status = 'decided' where id = 'e2173000-0000-4000-8000-00000000000a';
select is((select status || ' ' || to_char(publish_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') from public.schedule_slots
  where deliverable_id = 'e2173000-0000-4000-8000-00000000000a'), 'proposed 16:00', 'approved: a LinkedIn slot in the founder''s time');
select is((select count(*)::int from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where s.deliverable_id = 'e2173000-0000-4000-8000-00000000000a' and a.kind = 'schedule' and a.status = 'waiting'), 1, 'with its card');

-- Posted by hand: the slot and its card go.
update public.content_items set status = 'published', published_at = now() where id = 'e2172000-0000-4000-8000-00000000000a';
select is((select status from public.schedule_slots where deliverable_id = 'e2173000-0000-4000-8000-00000000000a'), 'cancelled',
  'posted by hand: the slot is dropped');
select is((select count(*)::int from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where s.deliverable_id = 'e2173000-0000-4000-8000-00000000000a' and a.status = 'waiting'), 0, 'and its card');

-- A short: P3 approves its captions when its deliverable appears (the batch card covered them); a caption approved
-- later adds its platform.
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e2174000-0000-4000-8000-00000000000a', 'e2170000-0000-4000-8000-00000000000a', 'https://a', 60, 'done');
insert into public.clips (id, job_id, idx, hook, start_seconds, end_seconds, kind) values
  ('e2175000-0000-4000-8000-00000000000a', 'e2174000-0000-4000-8000-00000000000a', -1, 'Short', 0, 0, 'blank');
insert into public.content_items (id, user_id, department, platform, day, idea, status, clip_id, body) values
  ('e2172000-0000-4000-8000-00000000000b', 'e2170000-0000-4000-8000-00000000000a', 'video', 'youtube', current_date,
   'Caption', 'in_review', 'e2175000-0000-4000-8000-00000000000a', '{"text":"How we cut by words","title":"Cut by words"}');
insert into public.deliverables (id, user_id, order_id, kind, ref_kind, ref_id, status) values
  ('e2173000-0000-4000-8000-00000000000b', 'e2170000-0000-4000-8000-00000000000a', 'e2171000-0000-4000-8000-00000000000a',
   'short', 'clip', 'e2175000-0000-4000-8000-00000000000a', 'ready');
select is((select platform from public.schedule_slots where deliverable_id = 'e2173000-0000-4000-8000-00000000000b'), 'youtube',
  'an approved short: a YouTube slot for its caption');
select is((select snapshot->>'title' from public.approvals a join public.schedule_slots s on s.id = a.ref_id
  where s.deliverable_id = 'e2173000-0000-4000-8000-00000000000b' and a.status = 'waiting'), 'Cut by words', 'the card carries the YouTube title');
insert into public.content_items (id, user_id, department, platform, day, idea, status, clip_id, body) values
  ('e2172000-0000-4000-8000-00000000000c', 'e2170000-0000-4000-8000-00000000000a', 'video', 'tiktok_caption', current_date,
   'Caption', 'drafting', 'e2175000-0000-4000-8000-00000000000a', '{"text":"Cut by words"}');
update public.content_items set status = 'approved' where id = 'e2172000-0000-4000-8000-00000000000c';
select is((select string_agg(platform, ',' order by platform) from public.schedule_slots where deliverable_id = 'e2173000-0000-4000-8000-00000000000b'),
  'tiktok,youtube', 'a caption approved later adds its platform');

select * from finish();
rollback;
