-- Every video script comes with its caption (owner, 2026-11-12, daily core drafts D1).
--
-- Writer writes the caption in the same call as the script. The rule that puts a finished script on its order
-- (`work_orders_brief_rules`, last written in 20270112010000) copies named keys only, so the caption is added to them
-- here; nothing else in the function changes. The script card, the Script tab and the caption of the finished video
-- read it from the order, which the founder already reads under RLS.

create or replace function public.work_orders_brief_rules() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brief jsonb;
  v_sources jsonb;
  v_video public.work_orders;
begin
  if new.kind not in ('write_video_brief', 'write_slides', 'niche_video_research') or new.status = old.status or new.status not in ('done', 'failed', 'cancelled') then
    return new;
  end if;
  -- Niche research ended, however it ended: the video briefs waiting on it start now (P5 R2), with the plan's input.
  if new.kind = 'niche_video_research' then
    for v_video in
      select * from public.work_orders where user_id = new.user_id and new.id = any(depends_on) and status = 'queued'
        and kind = 'write_video_brief' for update
    loop
      update public.work_orders set depends_on = array_remove(depends_on, new.id), updated_at = now()
      where id = v_video.id returning * into v_video;
      perform public.writer_order_start(v_video, jsonb_build_object('idea', v_video.brief->>'objective',
        'reason', coalesce(v_video.brief->>'reason', ''), 'seconds', public.cmo_video_seconds(), 'aspect', '9:16', 'platform', v_video.brief->>'platform'));
    end loop;
    return new;
  end if;
  -- A script (owner, 2026-11-09): no video waits on this brief. Its storyboard goes on the order and a script card asks
  -- the founder; they record the video themselves.
  if new.kind = 'write_video_brief'
     and not exists (select 1 from public.work_orders where user_id = new.user_id and new.id = any(depends_on)
                     and status not in ('done', 'failed', 'cancelled')) then
    if new.status = 'done' then
      begin
        select r.output->'brief', r.output->'sources' into v_brief, v_sources from public.cmo_runs r where r.id = new.run_id;
        if jsonb_typeof(v_sources) is distinct from 'array' or jsonb_array_length(v_sources) > 6 or octet_length(v_sources::text) > 4096 then
          v_sources := null;
        end if;
        if jsonb_typeof(v_brief->'storyboard') = 'array' and jsonb_array_length(v_brief->'storyboard') between 3 and 8
           and octet_length((v_brief->'storyboard')::text) <= 16384
           and char_length(coalesce(v_brief->>'objective', '')) between 3 and 300 then
          update public.work_orders
          set brief = brief || jsonb_strip_nulls(jsonb_build_object('objective', v_brief->'objective', 'angle', v_brief->'angle',
                'hooks', v_brief->'hooks', 'cta', v_brief->'cta', 'seconds', v_brief->'seconds', 'aspect', v_brief->'aspect',
                'storyboard', v_brief->'storyboard', 'sources', v_sources, 'brief_from', 'writer',
                -- The caption written with the script (owner, 2026-11-12); one that is too long is left out, the script stays.
                'caption', case when jsonb_typeof(v_brief->'caption') = 'string'
                                 and char_length(v_brief->>'caption') between 1 and 2200 then v_brief->'caption' end)),
              updated_at = now()
          where id = new.id;
          -- The plan dropped its item while it was being written: no card for a video the founder removed.
          if new.item_id is not null then
            perform public.approval_raise(new.user_id, 'work_order', new.id);
            update public.content_items set status = 'in_review', updated_at = now()
            where id = new.item_id and status in ('planned', 'drafting');
          end if;
        else
          perform public.work_order_event(new, 'note', 'Writer could not write the script for “' || new.title || '”');
        end if;
      exception when others then
        raise warning 'script rule for order % failed: %', new.id, sqlerrm;
      end;
    end if;
    return new;
  end if;
  -- Writer's slides (P5 S3) go into the slideshow order waiting on them, as the video brief goes into its video.
  if new.kind = 'write_slides' then
    begin
      if new.status = 'done' then
        select r.output into v_brief from public.cmo_runs r where r.id = new.run_id;
        if jsonb_typeof(v_brief->'slides') is distinct from 'array' or jsonb_array_length(v_brief->'slides') not between 1 and 20
           or octet_length((v_brief->'slides')::text) > 16384 then
          v_brief := null;
        end if;
      end if;
      for v_video in
        select * from public.work_orders where user_id = new.user_id and new.id = any(depends_on) and status = 'queued'
          and kind = 'build_slideshow' for update
      loop
        if v_brief is not null then
          update public.work_orders
          set brief = (brief - array['slides', 'slides_reason'])
                || jsonb_strip_nulls(jsonb_build_object('slides', v_brief->'slides', 'slides_reason', v_brief->>'reason',
                     'brief_from', 'writer')),
              updated_at = now()
          where id = v_video.id;
          perform public.work_order_event(v_video, 'note', 'Writer wrote the slides for “' || v_video.title || '”');
        else
          update public.work_orders set depends_on = array_remove(depends_on, new.id), updated_at = now() where id = v_video.id;
          perform public.work_order_event(v_video, 'note', '“' || v_video.title || '” goes on without Writer''s slides');
        end if;
      end loop;
    exception when others then
      raise warning 'slides rule for order % failed: %', new.id, sqlerrm;
      update public.work_orders set depends_on = array_remove(depends_on, new.id), updated_at = now()
      where user_id = new.user_id and new.id = any(depends_on) and status = 'queued';
    end;
    return new;
  end if;
  begin
    if new.status = 'done' then
      select r.output->'brief', r.output->'sources' into v_brief, v_sources from public.cmo_runs r where r.id = new.run_id;
      -- The niche videos the brief learned from (P5 F8): links only, the job keeps only those its research read.
      if jsonb_typeof(v_sources) is distinct from 'array' or jsonb_array_length(v_sources) > 6
         or octet_length(v_sources::text) > 4096 then
        v_sources := null;
      end if;
      if jsonb_typeof(v_brief) is distinct from 'object' or char_length(coalesce(v_brief->>'objective', '')) not between 3 and 300 then
        v_brief := null;
      end if;
    end if;
    for v_video in
      select * from public.work_orders where user_id = new.user_id and new.id = any(depends_on) and status = 'queued' for update
    loop
      if v_brief is not null then
        update public.work_orders
        set brief = (brief - array['objective', 'angle', 'hooks', 'key_points', 'cta', 'seconds', 'aspect', 'sources'])
              || jsonb_strip_nulls(jsonb_build_object('objective', v_brief->'objective', 'angle', v_brief->'angle',
                   'hooks', v_brief->'hooks', 'key_points', coalesce(v_brief->'keyPoints', v_brief->'key_points'),
                   'cta', v_brief->'cta', 'seconds', v_brief->'seconds', 'aspect', v_brief->'aspect', 'brief_from', 'writer',
                   'sources', v_sources)),
            updated_at = now()
        where id = v_video.id;
        perform public.work_order_event(v_video, 'note', 'Writer wrote the brief for “' || v_video.title || '”');
      else
        update public.work_orders set depends_on = array_remove(depends_on, new.id), updated_at = now() where id = v_video.id;
        perform public.work_order_event(v_video, 'note', '“' || v_video.title || '” goes on with the plan''s own brief');
      end if;
    end loop;
  exception when others then
    -- The brief could not be taken (too long for the order, say): the video still goes on, with its own brief.
    raise warning 'brief rule for order % failed: %', new.id, sqlerrm;
    update public.work_orders set depends_on = array_remove(depends_on, new.id), updated_at = now()
    where user_id = new.user_id and new.id = any(depends_on) and status = 'queued';
  end;
  return new;
end;
$$;

revoke all on function public.work_orders_brief_rules() from public, anon, authenticated;
