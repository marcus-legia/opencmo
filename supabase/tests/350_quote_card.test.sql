-- Wave 4b A4: post_set_quote_card keeps a quote of the founder's own Library entry, word for word, on a post whose
-- photos hold the image; clearing it, and a photo removal, take it off.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

insert into auth.users (id, email) values
  ('e3500000-0000-4000-8000-00000000000a', 'qc-a@test.local'),
  ('e3500000-0000-4000-8000-00000000000b', 'qc-b@test.local');
insert into public.opportunities (id, user_id, platform, url, community, title, score, reply) values
  ('e3500000-0000-4000-8000-0000000000c1', 'e3500000-0000-4000-8000-00000000000a', 'reddit',
   'https://www.reddit.com/r/saas/comments/1/x/', 'saas', 'T', 70, ''),
  ('e3500000-0000-4000-8000-0000000000c2', 'e3500000-0000-4000-8000-00000000000b', 'reddit',
   'https://www.reddit.com/r/saas/comments/2/x/', 'saas', 'T', 70, '');
insert into public.library_entries (opportunity_id, user_id, summary, quotes, platform, community) values
  ('e3500000-0000-4000-8000-0000000000c1', 'e3500000-0000-4000-8000-00000000000a', 'Forms cost too much',
   '[{"kind":"pain","text":"I pay $50 a month for forms nobody fills."}]', 'reddit', 'r/saas'),
  ('e3500000-0000-4000-8000-0000000000c2', 'e3500000-0000-4000-8000-00000000000b', 'Other',
   '[{"kind":"pain","text":"Not yours."}]', 'reddit', 'r/saas');
insert into public.content_items (id, user_id, department, platform, day, idea, status, body, photos) values
  ('e3500000-0000-4000-8000-0000000000d1', 'e3500000-0000-4000-8000-00000000000a', 'post', 'x', current_date, 'Idea',
   'in_review', '{"text":"Post."}',
   array['e3500000-0000-4000-8000-00000000000a/e3500000-0000-4000-8000-0000000000d1/quote.png']);

create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.as_user('e3500000-0000-4000-8000-00000000000a');
set local role authenticated;

select throws_ok($$ select public.post_set_quote_card('e3500000-0000-4000-8000-0000000000d1',
  'e3500000-0000-4000-8000-0000000000c2', 'Not yours.', 'e3500000-0000-4000-8000-00000000000a/e3500000-0000-4000-8000-0000000000d1/quote.png') $$,
  'P0002', 'This conversation is not in your Library.', 'another founder''s entry is refused');
select throws_ok($$ select public.post_set_quote_card('e3500000-0000-4000-8000-0000000000d1',
  'e3500000-0000-4000-8000-0000000000c1', 'I pay $50 a month for forms.', 'e3500000-0000-4000-8000-00000000000a/e3500000-0000-4000-8000-0000000000d1/quote.png') $$,
  '22023', 'Pick one of the quotes kept from this conversation.', 'a quote not kept word for word is refused');
select throws_ok($$ select public.post_set_quote_card('e3500000-0000-4000-8000-0000000000d1',
  'e3500000-0000-4000-8000-0000000000c1', 'I pay $50 a month for forms nobody fills.', 'e3500000-0000-4000-8000-00000000000a/other.png') $$,
  '22023', 'The quote card image is missing. Make it again.', 'an image that is not one of the post''s photos is refused');
select lives_ok($$ select public.post_set_quote_card('e3500000-0000-4000-8000-0000000000d1',
  'e3500000-0000-4000-8000-0000000000c1', 'I pay $50 a month for forms nobody fills.', 'e3500000-0000-4000-8000-00000000000a/e3500000-0000-4000-8000-0000000000d1/quote.png') $$,
  'the founder''s own quote is kept');
reset role;
select is((select body->'quote_card'->>'community' from public.content_items where id = 'e3500000-0000-4000-8000-0000000000d1'),
  'r/saas', 'the card carries the community, from the entry');

select pg_temp.as_user('e3500000-0000-4000-8000-00000000000a');
set local role authenticated;
select lives_ok($$ select public.post_set_quote_card('e3500000-0000-4000-8000-0000000000d1', null, null) $$, 'clearing it');
reset role;
select ok(not (select body ? 'quote_card' from public.content_items where id = 'e3500000-0000-4000-8000-0000000000d1'),
  'a cleared post has no quote card');

-- A removed photo takes the quote card with it.
update public.content_items set body = body || '{"quote_card":{"object":"e3500000-0000-4000-8000-00000000000a/e3500000-0000-4000-8000-0000000000d1/quote.png"}}'
where id = 'e3500000-0000-4000-8000-0000000000d1';
update public.content_items set photos = '{}' where id = 'e3500000-0000-4000-8000-0000000000d1';
select ok(not (select body ? 'quote_card' from public.content_items where id = 'e3500000-0000-4000-8000-0000000000d1'),
  'removing its image removes the quote card');

select pg_temp.as_user('e3500000-0000-4000-8000-00000000000b');
set local role authenticated;
select throws_ok($$ select public.post_set_quote_card('e3500000-0000-4000-8000-0000000000d1', null, null) $$,
  'P0002', 'Post not found.', 'another founder cannot touch the post');
reset role;

select * from finish();
rollback;
