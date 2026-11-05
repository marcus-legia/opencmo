-- cmo-review B2.6 (20270106030000): a Studio card sent back with a reason becomes a 'video' memory the next brief
-- reads; an approval, a post card or a send-back with no reason writes none.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(5);

insert into auth.users (id, email) values ('e2470000-0000-4000-8000-00000000000a', 'b26@test.local');

insert into public.approvals (id, user_id, kind, department, ref_kind, ref_id, snapshot, content_hash) values
  ('e2471000-0000-4000-8000-000000000001', 'e2470000-0000-4000-8000-00000000000a', 'finished_video', 'studio', 'editor_project',
   gen_random_uuid(), '{"title":"How the CMO plans a week"}', repeat('a', 64)),
  ('e2471000-0000-4000-8000-000000000002', 'e2470000-0000-4000-8000-00000000000a', 'shorts_batch', 'studio', 'short_batch',
   gen_random_uuid(), '{}', repeat('b', 64)),
  ('e2471000-0000-4000-8000-000000000003', 'e2470000-0000-4000-8000-00000000000a', 'post', 'writer', 'content_item',
   gen_random_uuid(), '{}', repeat('c', 64));

-- As approval_decide does it: the status first, then the reason.
update public.approvals set status = 'skipped', decided_at = now() where id = 'e2471000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.cmo_memories where user_id = 'e2470000-0000-4000-8000-00000000000a'), 0,
  'no reason yet, no memory');
update public.approvals set reason = 'The voice is too fast' where id = 'e2471000-0000-4000-8000-000000000001';
select is((select topic || ' ' || kind || ' ' || importance || ' ' || body from public.cmo_memories where user_id = 'e2470000-0000-4000-8000-00000000000a'),
  'video feedback 3 Sent back the video “How the CMO plans a week”: The voice is too fast', 'the reason is a video lesson');

update public.approvals set status = 'skipped', reason = 'Cut the intro' where id = 'e2471000-0000-4000-8000-000000000002';
select ok(exists (select 1 from public.cmo_memories where user_id = 'e2470000-0000-4000-8000-00000000000a'
  and body = 'Sent back the shorts: Cut the intro'), 'shorts without a title');

update public.approvals set status = 'skipped', reason = 'Too salesy' where id = 'e2471000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.cmo_memories where user_id = 'e2470000-0000-4000-8000-00000000000a'), 2,
  'a post card is Writer''s own learning, not this one');

update public.approvals set decided_via = 'app' where id = 'e2471000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.cmo_memories where user_id = 'e2470000-0000-4000-8000-00000000000a'), 2,
  'touching the card again writes nothing twice');

select * from finish();
rollback;
