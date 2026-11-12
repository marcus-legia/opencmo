-- 20270118020000: an API key names its owner only while the account is neither banned nor deleted.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(8);

select ok(has_function_privilege('service_role', 'public.api_key_owner(text)', 'execute'), 'the MCP server can still look a key up');
select ok(not has_function_privilege('authenticated', 'public.api_key_owner(text)', 'execute'), 'a founder cannot');

insert into auth.users (id, email) values
  ('e2970000-0000-4000-8000-00000000000a', 'key-ok@test.local'),
  ('e2970000-0000-4000-8000-00000000000b', 'key-banned@test.local'),
  ('e2970000-0000-4000-8000-00000000000c', 'key-deleted@test.local'),
  ('e2970000-0000-4000-8000-00000000000d', 'key-unbanned@test.local');

insert into public.api_keys (user_id, name, prefix, key_hash) values
  ('e2970000-0000-4000-8000-00000000000a', 'ok', 'ocm_aaaaaaaa', repeat('a', 64)),
  ('e2970000-0000-4000-8000-00000000000b', 'banned', 'ocm_bbbbbbbb', repeat('b', 64)),
  ('e2970000-0000-4000-8000-00000000000c', 'deleted', 'ocm_cccccccc', repeat('c', 64)),
  ('e2970000-0000-4000-8000-00000000000d', 'ban over', 'ocm_dddddddd', repeat('d', 64));

select is(public.api_key_owner(repeat('b', 64)), 'e2970000-0000-4000-8000-00000000000b'::uuid, 'before the ban the key works');

update auth.users set banned_until = now() + interval '100 years' where id = 'e2970000-0000-4000-8000-00000000000b';
update auth.users set deleted_at = now() where id = 'e2970000-0000-4000-8000-00000000000c';
update auth.users set banned_until = now() - interval '1 hour' where id = 'e2970000-0000-4000-8000-00000000000d';
update public.api_keys set last_used_at = null where user_id = 'e2970000-0000-4000-8000-00000000000b';

select is(public.api_key_owner(repeat('a', 64)), 'e2970000-0000-4000-8000-00000000000a'::uuid, 'an account in good standing keeps its key');
select is(public.api_key_owner(repeat('b', 64)), null, 'a banned account''s key names nobody');
select is((select last_used_at from public.api_keys where key_hash = repeat('b', 64)), null, 'and is not marked as used');
select is(public.api_key_owner(repeat('c', 64)), null, 'a deleted account''s key names nobody');
select is(public.api_key_owner(repeat('d', 64)), 'e2970000-0000-4000-8000-00000000000d'::uuid, 'a ban that ended gives the key back');

select * from finish();
rollback;
