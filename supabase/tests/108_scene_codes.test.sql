-- Code Scenes (20261010090000): scene code is stored by sha256 and only its owner reads it.
-- The 3D model that rendered it is gone (20261227090000); explainers check code_ref in 154.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select no_plan();

insert into auth.users (id, email) values
  ('e1080000-0000-4000-8000-00000000000a', 'code-a@test.local'),
  ('e1080000-0000-4000-8000-00000000000b', 'code-b@test.local');
insert into public.jobs (id, user_id, source_url, duration_seconds, status) values
  ('e1081000-0000-4000-8000-00000000000a', 'e1080000-0000-4000-8000-00000000000a', 'https://a', 600, 'done');
insert into public.credit_ledger(user_id, delta, reason) values
  ('e1080000-0000-4000-8000-00000000000a', 10, 'test grant');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1080000-0000-4000-8000-00000000000a"}';

select is(
  public.save_scene_code('return (t) => {};'),
  encode(sha256(convert_to('return (t) => {};', 'UTF8')), 'hex'),
  'trả sha256 hex của code'
);
select is(public.save_scene_code('return (t) => {};'), public.save_scene_code('return (t) => {};'), 'cùng code cùng hash');
select is((select count(*) from public.scene_codes)::int, 1, 'không ghi lần hai');
select throws_ok($$ select public.save_scene_code('   ') $$, '22023', 'Write the scene code first.', 'code rỗng bị chặn');
select throws_ok($$ select public.save_scene_code(repeat('x', 32001)) $$, '22023',
  'The scene code is longer than 32000 characters.', 'code quá dài bị chặn');
select throws_ok($$ insert into public.scene_codes (user_id, hash, code)
  values ('e1080000-0000-4000-8000-00000000000a', repeat('c', 64), 'x') $$,
  '42501', null, 'không ghi thẳng vào bảng');

-- Người B: không đọc được code của A, không render được bằng hash của A.
set local request.jwt.claims = '{"sub":"e1080000-0000-4000-8000-00000000000b"}';
select is((select count(*) from public.scene_codes)::int, 0, 'B không thấy code của A');

select * from finish();
rollback;
