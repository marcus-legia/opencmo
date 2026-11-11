-- 20270116010000: an X thread is the Writer's, and a rule that forbids the risky thing is the safe rule; both are
-- kept. A risky rule beside a negated clause is still refused.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(9);

select is(public.sales_ban_risk('Put the link to my site in the last post of each thread', false), null, 'an X thread rule is the Writer''s');
select is(public.sales_ban_risk('Never add links in Reddit replies', false), null, 'never adding links is the safe rule');
select is(public.sales_ban_risk('Don''t include a URL in replies', false), null, 'so is not including one');
select is(public.sales_ban_risk('Don’t include a URL in replies', false), null, 'with a typographic apostrophe too');
select is(public.sales_ban_risk('Do not reply as the official company account', false), null, 'not replying as the company');
select alike(public.sales_ban_risk('Never add hashtags, add a link to every reply', false), 'Replies never carry a link%', 'a risky clause beside a negated one');
select alike(public.sales_ban_risk('Don''t forget to include our website in replies', false), 'Replies never carry a link%', '"don''t forget" is not a no');
select alike(public.sales_ban_risk('Answer Reddit threads on behalf of the company', false), 'Replies come from you%', 'Reddit threads are still Sales');
select alike(public.sales_ban_risk('Always add the link to our site', true), 'Replies never carry a link%', 'a sales note still needs no Sales word');

select * from finish();
rollback;
