-- 20261229090000: P3 A0, the contracts Writer for every platform builds on (plan §5; sessions/A.md A0).
--
-- - `platform_profile(id)`: SQL's copy of `packages/contracts/platforms.json` (limit, title, hashtags). check:contracts
--   compares the two, so a number changes in both or the check fails.
-- - `cmo_draft_outcomes.platform`: which profile a decided draft was for, filled from the post's row on insert, so
--   voice notes and corrections can say "per platform".
-- - Voice notes are `cmo_memories` rows (topic `post`, kind `preference`) with `source_outcome`: the decision they
--   were learned from. One note per decision; an index reads them newest first.
-- - A caption is a `content_items` row (department `video`) for one edit (`clip_id`); its deliverable points at the
--   video or short deliverable it belongs to (`deliverables.parent_id`).

begin;

create or replace function public.platform_profile(p_id text) returns jsonb
language sql immutable set search_path = public
as $$
  select case p_id
    when 'x' then '{"kind": "post", "limit": 280, "title": null, "hashtags": 0, "label": "X"}'::jsonb
    when 'threads' then '{"kind": "post", "limit": 500, "title": null, "hashtags": 0, "label": "Threads"}'::jsonb
    when 'linkedin' then '{"kind": "post", "limit": 3000, "title": null, "hashtags": 0, "label": "LinkedIn"}'::jsonb
    when 'instagram_caption' then '{"kind": "caption", "limit": 2200, "title": null, "hashtags": 5, "label": "Instagram caption"}'::jsonb
    when 'tiktok_caption' then '{"kind": "caption", "limit": 2200, "title": null, "hashtags": 5, "label": "TikTok caption"}'::jsonb
    when 'youtube' then '{"kind": "youtube", "limit": 5000, "title": 100, "hashtags": 3, "label": "YouTube title and description"}'::jsonb
  end
$$;
-- Read only by definer functions and the outcome check (whose writers are definer functions too).
revoke all on function public.platform_profile(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ Outcomes per platform

alter table public.cmo_draft_outcomes add column if not exists platform text;
alter table public.cmo_draft_outcomes drop constraint if exists cmo_draft_outcomes_platform_check;
alter table public.cmo_draft_outcomes add constraint cmo_draft_outcomes_platform_check
  check (platform is null or public.platform_profile(platform) is not null);

-- Every writer of outcomes (cmo_decide_post, the skip and Sales paths) gets the platform without being changed.
create or replace function public.cmo_draft_outcomes_platform() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.platform is null and new.department = 'post' then
    select c.platform into new.platform from public.content_items c
    where c.id = new.item_id and public.platform_profile(c.platform) is not null;
  end if;
  return new;
end;
$$;
revoke all on function public.cmo_draft_outcomes_platform() from public, anon, authenticated;

drop trigger if exists cmo_draft_outcomes_platform on public.cmo_draft_outcomes;
create trigger cmo_draft_outcomes_platform before insert on public.cmo_draft_outcomes
  for each row execute function public.cmo_draft_outcomes_platform();

-- Posts decided before this phase were all for X; read the row anyway, it is the source of truth.
update public.cmo_draft_outcomes o set platform = c.platform
from public.content_items c
where o.platform is null and o.department = 'post' and c.id = o.item_id and public.platform_profile(c.platform) is not null;

-- ------------------------------------------------------------------ Voice notes

alter table public.cmo_memories add column if not exists source_outcome uuid
  references public.cmo_draft_outcomes (id) on delete set null;
create unique index if not exists cmo_memories_source_outcome_key on public.cmo_memories (source_outcome)
  where source_outcome is not null;
create index if not exists cmo_memories_voice_idx on public.cmo_memories (user_id, created_at desc)
  where topic = 'post' and kind = 'preference';

-- ------------------------------------------------------------------ Captions

alter table public.content_items add column if not exists clip_id uuid references public.clips (id) on delete cascade;
alter table public.content_items drop constraint if exists content_items_clip_check;
alter table public.content_items add constraint content_items_clip_check check (clip_id is null or department = 'video');
create index if not exists content_items_clip_idx on public.content_items (clip_id) where clip_id is not null;

alter table public.deliverables add column if not exists parent_id uuid references public.deliverables (id) on delete cascade;
alter table public.deliverables drop constraint if exists deliverables_parent_check;
alter table public.deliverables add constraint deliverables_parent_check check (parent_id is null or kind = 'caption');
create index if not exists deliverables_parent_idx on public.deliverables (parent_id) where parent_id is not null;

-- A caption belongs to a video or short of the same founder; a check constraint cannot read the parent row.
create or replace function public.deliverables_parent_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.deliverables p
    where p.id = new.parent_id and p.user_id = new.user_id and p.kind in ('video', 'short')
  ) then
    raise exception 'A caption belongs to one of your videos or shorts.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.deliverables_parent_guard() from public, anon, authenticated;

drop trigger if exists deliverables_parent_guard on public.deliverables;
create trigger deliverables_parent_guard before insert or update of parent_id, user_id on public.deliverables
  for each row execute function public.deliverables_parent_guard();

commit;
