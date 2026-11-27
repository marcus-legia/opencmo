-- X News stories (plan docs/superpowers/plans/2026-11-27-content-plan-and-x-news.md, Part B1).
--
-- One snapshot every three hours reads X News with Ferreto's own app-only token and stores the stories here; every
-- founder's drafts pick from the newest snapshot. Nothing here belongs to a founder, so no user role reads or writes
-- it: only the service role (the snapshot cron, the CMO runner) and the cleanup's definer function.
--
-- Story names, summaries and hooks are written by X's Grok from strangers' posts: they are untrusted text, kept
-- short by the checks below and wrapped in tags wherever they reach a prompt.

begin;

create table if not exists public.x_news_stories (
  id uuid primary key default gen_random_uuid(),
  taken_at timestamptz not null,
  story_id text not null check (story_id ~ '^[0-9]{1,19}$'),
  name text not null check (char_length(name) between 1 and 120),
  summary text not null default '' check (char_length(summary) <= 1000),
  hook text not null default '' check (char_length(hook) <= 400),
  category text not null default '' check (char_length(category) <= 60),
  post_ids text[] not null default '{}' check (cardinality(post_ids) <= 10),
  story_updated_at timestamptz,
  relevant boolean not null default false,
  topic_key text not null default '' check (topic_key ~ '^[a-z0-9-]{0,60}$'),
  -- Drafts dedupe a day's posts by topic_key, so a story they may pick always has one.
  check (not relevant or topic_key <> ''),
  -- Its btree starts with taken_at, so it also serves "the newest snapshot" and the cleanup: no second index.
  unique (taken_at, story_id)
);

alter table public.x_news_stories enable row level security;
revoke all on public.x_news_stories from public, anon, authenticated;
grant select, insert, update, delete on public.x_news_stories to service_role;

-- The daily cleanup drops snapshots older than `p_days` (14 by default): a draft only reads the last six hours, and
-- two weeks is enough to look back at what a card rode.
create or replace function public.x_news_purge(p_days integer default 14) returns integer
language plpgsql security definer
set search_path to ''
as $$
declare
  v_rows integer;
begin
  if p_days is null or p_days < 1 then
    raise exception 'Keep at least one day of news.' using errcode = '22023';
  end if;
  delete from public.x_news_stories where taken_at < now() - make_interval(days => p_days);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke all on function public.x_news_purge(integer) from public, anon, authenticated;
grant execute on function public.x_news_purge(integer) to service_role;

commit;
