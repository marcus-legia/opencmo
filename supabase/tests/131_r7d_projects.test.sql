-- 20261102090000 (R7d): bảng projects — mỗi đường tạo project ghi đúng một hàng,
-- thư viện đọc từ đó, người khác không thấy, người dùng không tự ghi được.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(10);

insert into auth.users (id, email) values
  ('e1310000-0000-4000-8000-00000000000a', 'r7d-a@test.local'),
  ('e1310000-0000-4000-8000-00000000000b', 'r7d-b@test.local');
insert into public.credit_ledger (user_id, delta, reason) values ('e1310000-0000-4000-8000-00000000000a', 50, 'test grant');

-- An upload the user reserved and finished: what `create_upload_edit` consumes.
create function pg_temp.upload(p_user uuid, p_name text) returns text
language plpgsql security definer set search_path = public as $$
begin
  insert into public.upload_reservations (user_id, bucket, object_name, declared_size, content_type)
  values (p_user, 'sources', p_user || '/' || p_name, 1000, 'video/mp4');
  insert into storage.objects (bucket_id, name, metadata)
  values ('sources', p_user || '/' || p_name, '{"size": 100, "mimetype": "video/mp4"}');
  return 'storage://' || p_user || '/' || p_name;
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1310000-0000-4000-8000-00000000000a"}';

create temporary table made as
  select (public.create_upload_edit(pg_temp.upload(auth.uid(), 'r7d.mp4'))).id as clip_job;
alter table made add column blank_clip uuid;
update made set blank_clip = public.create_blank_edit('Launch teaser', '9:16');

select is((select kind from public.projects where job_id = (select clip_job from made)), 'clip', 'create_upload_edit → project clip');
select is((select p.kind from public.projects p join public.clips c on c.job_id = p.job_id where c.id = (select blank_clip from made)),
  'edit', 'create_blank_edit → project edit');
select is((select count(*)::int from public.projects), 2, 'mỗi lượt tạo đúng một hàng (người dùng chỉ thấy hàng của mình)');

select is(
  (select array_agg(id order by id) from public.list_projects()),
  (select array_agg(job_id order by job_id) from public.projects where kind = 'clip'),
  'thư viện = uploads, không có New edit trống'
);
select is((select count(*)::int from public.list_projects(null, null, 'nothing-matches', 24)), 0, 'tìm theo tên vẫn chạy');

select throws_ok(
  $$ insert into public.projects (user_id, job_id, kind) values ('e1310000-0000-4000-8000-00000000000a', (select clip_job from made), 'clip') $$,
  '42501', null, 'người dùng không tự ghi project'
);
select throws_ok(
  $$ update public.projects set kind = 'edit' $$,
  '42501', null, 'người dùng không tự đổi project'
);

set local request.jwt.claims = '{"sub":"e1310000-0000-4000-8000-00000000000b"}';
select is((select count(*)::int from public.projects), 0, 'người khác không thấy project của A');
select is((select count(*)::int from public.list_projects()), 0, 'thư viện của B rỗng');

reset role;
delete from public.jobs where id = (select clip_job from made);
select is((select count(*)::int from public.projects where job_id = (select clip_job from made)), 0, 'xoá job thì xoá project');

select * from finish();
rollback;
