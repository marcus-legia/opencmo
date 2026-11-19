-- Wave 3 review (20270201090000): "I replied" takes the links people copy (Reddit comment and share links, Threads
-- with a query or on threads.net) and stores them cleaned; "I sent it" on a DM or email is not a public reply, so no
-- nudge is drafted for it and no reply is re-read.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(16);

insert into auth.users (id, email) values
  ('e3460000-0000-4000-8000-00000000000a', 'rrf-a@test.local'),
  ('e3460000-0000-4000-8000-00000000000b', 'rrf-b@test.local');
insert into public.opportunities (id, user_id, platform, url, community, title, score, reply, status) values
  ('e3460000-0000-4000-8000-0000000000c1', 'e3460000-0000-4000-8000-00000000000a', 'reddit',
   'https://www.reddit.com/r/freelance/comments/abc123/late_invoices/', 'freelance', 'Late invoices', 70, 'Reply.', 'in_review'),
  ('e3460000-0000-4000-8000-0000000000c2', 'e3460000-0000-4000-8000-00000000000a', 'threads',
   'https://www.threads.com/@sam/post/AbC', '', 'Threads', 70, 'Reply.', 'in_review'),
  ('e3460000-0000-4000-8000-0000000000c3', 'e3460000-0000-4000-8000-00000000000a', 'reddit',
   'https://www.reddit.com/r/SaaS/comments/dm1/x/', 'SaaS', 'DM', 70, 'Reply.', 'in_review'),
  ('e3460000-0000-4000-8000-0000000000d1', 'e3460000-0000-4000-8000-00000000000b', 'reddit',
   'https://www.reddit.com/r/b/comments/1/x/', 'b', 'B', 70, 'Reply.', 'in_review');

-- The link check, cleaned first as the RPC does.
select ok(public.reply_url_fits('reddit', 'https://www.reddit.com/r/freelance/comments/abc123/late_invoices/',
  public.reply_url_clean('reddit', 'https://www.reddit.com/r/freelance/comments/abc123/comment/xyz789/?utm_source=share')),
  'a Reddit comment link (no slug, a query) fits its thread');
select ok(public.reply_url_fits('reddit', 'https://www.reddit.com/r/freelance/comments/abc123/late_invoices/',
  'https://old.reddit.com/r/Freelance/comments/ABC123/late_invoices/xyz789'), 'case and old.reddit do not matter');
select ok(public.reply_url_fits('reddit', 'https://www.reddit.com/r/freelance/comments/abc123/late_invoices/',
  'https://www.reddit.com/r/freelance/s/Zx81kQ'), 'a phone share link in the same subreddit fits');
select ok(not public.reply_url_fits('reddit', 'https://www.reddit.com/r/freelance/comments/abc123/late_invoices/',
  'https://www.reddit.com/r/freelance/comments/zzz999/other/'), 'another post in the subreddit does not');
select ok(not public.reply_url_fits('reddit', 'https://www.reddit.com/r/freelance/comments/abc123/late_invoices/',
  'https://www.reddit.com/r/SaaS/s/Zx81kQ'), 'a share link in another subreddit does not');
select is(public.reply_url_clean('threads', 'https://www.threads.net/@me/post/DeF/?xmt=AQG'), 'https://www.threads.com/@me/post/DeF',
  'a Threads link loses its query and slash and lands on www.threads.com');
select ok(public.reply_url_fits('threads', 'https://www.threads.com/@sam/post/AbC', public.reply_url_clean('threads', 'https://threads.com/@me/post/DeF/')),
  'a cleaned Threads link fits');
select is(public.reply_url_clean('hn', ' https://news.ycombinator.com/item?id=42 '), 'https://news.ycombinator.com/item?id=42', 'HN keeps its ?id=');

-- The RPCs, as the founder.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e3460000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

select is((public.opportunity_mark_replied('e3460000-0000-4000-8000-0000000000c2', 'https://www.threads.net/@me/post/DeF/?xmt=1')).reply_url,
  'https://www.threads.com/@me/post/DeF', '"I replied" stores the cleaned link');
select is((public.opportunity_mark_sent('e3460000-0000-4000-8000-0000000000c3', 'dm')).contacted_via, 'dm', '"I sent it" records a DM');
select is((select person_status || ' ' || status from public.opportunities where id = 'e3460000-0000-4000-8000-0000000000c3'),
  'replied replied', 'and moves the person to Following up');
select throws_ok($$ select public.opportunity_mark_sent('e3460000-0000-4000-8000-0000000000c3', 'sms') $$, '22023', null, 'only a DM or an email');
select throws_ok($$ select public.opportunity_mark_sent('e3460000-0000-4000-8000-0000000000d1', 'dm') $$, 'P0002', null,
  'not on another founder''s conversation');

reset role;

-- Four days on: the DM person gets no public nudge and no reply re-read; the replied one does.
update public.opportunities set replied_at = now() - interval '5 days', reply = 'Reply.'
  where id in ('e3460000-0000-4000-8000-0000000000c2', 'e3460000-0000-4000-8000-0000000000c3');
update public.cmo_draft_outcomes set decided_at = now() - interval '5 days'
  where item_id in ('e3460000-0000-4000-8000-0000000000c2', 'e3460000-0000-4000-8000-0000000000c3');
select is((select array_agg(opportunity_id order by opportunity_id) from public.cmo_nudges_due('e3460000-0000-4000-8000-00000000000a', 10)),
  array['e3460000-0000-4000-8000-0000000000c2'::uuid], 'a nudge for the public reply only');
select is((select count(*)::int from public.cmo_reply_outcomes_due('e3460000-0000-4000-8000-00000000000a', 10)
  where opportunity_id = 'e3460000-0000-4000-8000-0000000000c3'), 0, 'the DM is never re-read as a reply');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e3460000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select is((public.opportunity_mark_replied('e3460000-0000-4000-8000-0000000000c3', 'https://www.reddit.com/r/SaaS/comments/dm1/comment/q1/')).contacted_via,
  null, 'a public reply after the DM is followed as a reply');
reset role;

select * from finish();
rollback;
