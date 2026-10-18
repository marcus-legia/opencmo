-- 20261210200000: create_job refuses the SSRF encodings the audit found (fix 7, Session C).
--
-- The worker stays the authority: it resolves every hop and connects only to public addresses
-- (`validate_public_url` + GuardProxy). This is the quick refusal before credits are held, and it
-- used to miss `0.0.0.0`, `100.64/10`, `[::ffff:127.0.0.1]`, NAT64/6to4/Teredo, `2130706433`,
-- `0x7f.1`, `.internal`, `.local` and `localhost.`. The cases live in
-- `packages/contracts/private-addresses.json`; pgTAP 180 runs every one of them.
--
-- A parsed host instead of one more alternative in the old regex: the old regex is what missed
-- these, and the structure below mirrors `apps/web/lib/net/address.ts`.

begin;

create or replace function public.video_url_refused(p_url text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_authority text := lower(substring(p_url from '^[hH][tT][tT][pP][sS]?://([^/?#]*)'));
  v_host text;
  v_port text;
  v_octets int[];
  v_h1 int;
  v_h2 int;
begin
  if v_authority is null or v_authority = '' or v_authority ~ '[@[:space:]\\]' then
    return true;
  end if;
  if v_authority like '[%' then
    v_host := substring(v_authority from '^(\[[0-9a-f:.]*\])');
    if v_host is null then
      return true;
    end if;
    v_port := substring(v_authority from length(v_host) + 1);
  else
    v_host := split_part(v_authority, ':', 1);
    v_port := substring(v_authority from length(v_host) + 1);
  end if;
  if v_port <> '' and v_port not in (':', ':80', ':443') then
    return true;
  end if;

  if v_host like '[%' then
    -- Global unicast is 2000::/3; IPv4 hidden in IPv6 (mapped, NAT64, 6to4, Teredo) and every
    -- local range fall outside it or in the prefixes refused here.
    v_host := btrim(v_host, '[]');
    if v_host !~ '^[0-9a-f]{1,4}:' then
      return true;
    end if;
    v_h1 := ('x' || lpad(split_part(v_host, ':', 1), 8, '0'))::bit(32)::int;
    v_h2 := case when split_part(v_host, ':', 2) ~ '^[0-9a-f]{1,4}$'
      then ('x' || lpad(split_part(v_host, ':', 2), 8, '0'))::bit(32)::int else 0 end;
    return v_h1 < 8192 or v_h1 > 16383 or v_h1 = 8194 or (v_h1 = 8193 and (v_h2 < 512 or v_h2 = 3512));
  end if;

  v_host := rtrim(v_host, '.');
  if v_host !~ '\.' or v_host ~ '(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|onion)$' then
    return true;
  end if;
  -- Digits, dots and hex only: an address in some encoding. Only a plain dotted quad is judged;
  -- `0x7f.1`, `127.1` and `0177.0.0.1` are refused outright.
  if v_host ~ '^(0x[0-9a-f]*|[0-9]+)(\.(0x[0-9a-f]*|[0-9]+))*$' then
    if v_host !~ '^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$' then
      return true;
    end if;
    v_octets := string_to_array(v_host, '.')::int[];
    return v_octets[1] > 255 or v_octets[2] > 255 or v_octets[3] > 255 or v_octets[4] > 255
      or v_octets[1] in (0, 10, 127) or v_octets[1] >= 224
      or (v_octets[1] = 100 and v_octets[2] between 64 and 127)
      or (v_octets[1] = 169 and v_octets[2] = 254)
      or (v_octets[1] = 172 and v_octets[2] between 16 and 31)
      or (v_octets[1] = 192 and v_octets[2] = 168)
      or (v_octets[1] = 192 and v_octets[2] = 0 and v_octets[3] in (0, 2))
      or (v_octets[1] = 192 and v_octets[2] = 88 and v_octets[3] = 99)
      or (v_octets[1] = 198 and v_octets[2] in (18, 19))
      or (v_octets[1] = 198 and v_octets[2] = 51 and v_octets[3] = 100)
      or (v_octets[1] = 203 and v_octets[2] = 0 and v_octets[3] = 113);
  end if;
  return false;
end;
$$;

revoke all on function public.video_url_refused(text) from public, anon, authenticated;

create or replace function public.create_job(p_source_url text, p_clips integer DEFAULT 5, p_length text DEFAULT 'auto'::text, p_segments jsonb DEFAULT NULL::jsonb, p_mode text DEFAULT 'clip'::text, p_aspect text DEFAULT '9:16'::text, p_layout text DEFAULT 'auto'::text, p_captions boolean DEFAULT true, p_caption_preset text DEFAULT 'bold'::text) RETURNS public.jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_user uuid := public.require_user();
  v_hold int := public.job_hold_credits();
  v_balance int;
  v_plan text;
  v_length text := coalesce(p_length, 'auto');
  v_job public.jobs;
  v_source text := trim(coalesce(p_source_url, ''));
  v_segments jsonb := p_segments;
  v_clips int := p_clips;
  v_mode text := coalesce(p_mode, 'clip');
  v_aspect text := coalesce(p_aspect, '9:16');
  v_layout text := coalesce(p_layout, 'auto');
  v_captions boolean := coalesce(p_captions, true);
  v_preset text := coalesce(p_caption_preset, 'bold');
  v_prev numeric;
  v_item jsonb;
begin
  if v_source = '' then
    raise exception 'Missing video link.' using errcode = '22023';
  end if;
  if v_source not like 'storage://%'
     and (v_source !~* '^https?://[^/@[:space:]]+([/:?#]|$)' or public.video_url_refused(v_source))
  then
    raise exception 'Paste a public HTTP or HTTPS video link.' using errcode = '22023';
  end if;

  if v_mode not in ('clip', 'full') then
    raise exception 'Choose whether to clip the video or download it whole.' using errcode = '22023';
  end if;

  if v_segments is not null and jsonb_typeof(v_segments) = 'array'
     and jsonb_array_length(v_segments) = 0 then
    v_segments := null;
  end if;
  if v_mode = 'full' then
    if v_segments is not null then
      raise exception 'Picked moments only apply when we clip your video.' using errcode = '22023';
    end if;
    v_clips := 1;
  end if;

  if v_segments is not null then
    if jsonb_typeof(v_segments) <> 'array' then
      raise exception 'Pick the moments you want on the timeline.' using errcode = '22023';
    end if;
    if jsonb_array_length(v_segments) > 10 then
      raise exception 'Pick at most 10 moments.' using errcode = '22023';
    end if;

    v_prev := null;
    for v_item in
      select value from jsonb_array_elements(v_segments)
      order by (value ->> 'start')::numeric
    loop
      if jsonb_typeof(v_item) is distinct from 'object'
         or jsonb_typeof(v_item -> 'start') is distinct from 'number'
         or jsonb_typeof(v_item -> 'end') is distinct from 'number' then
        raise exception 'Each moment needs a start and end time.' using errcode = '22023';
      end if;
      if (v_item ->> 'start')::numeric < 0 then
        raise exception 'A moment cannot start before the video does.' using errcode = '22023';
      end if;
      if (v_item ->> 'end')::numeric - (v_item ->> 'start')::numeric < 1 then
        raise exception 'Each moment must be at least 1 second long.' using errcode = '22023';
      end if;
      if (v_item ->> 'end')::numeric - (v_item ->> 'start')::numeric > 180 then
        raise exception 'Each moment must be 3 minutes or shorter.' using errcode = '22023';
      end if;
      if v_prev is not null and (v_item ->> 'start')::numeric < v_prev then
        raise exception 'Your moments overlap. Move them apart and try again.' using errcode = '22023';
      end if;
      v_prev := (v_item ->> 'end')::numeric;
    end loop;

    select jsonb_agg(value order by (value ->> 'start')::numeric)
    into v_segments from jsonb_array_elements(v_segments);
    v_clips := jsonb_array_length(v_segments);
  end if;

  if v_clips < 1 or v_clips > 10 then
    raise exception 'Clip count must be between 1 and 10.' using errcode = '22023';
  end if;
  if v_length not in ('auto', 'short', 'medium', 'long') then
    raise exception 'Choose a clip length.' using errcode = '22023';
  end if;
  if v_aspect not in ('9:16', '1:1', '16:9') then
    raise exception 'Unsupported aspect ratio.' using errcode = '22023';
  end if;
  if v_layout not in ('auto', 'fill', 'fit') then
    raise exception 'Unsupported frame layout.' using errcode = '22023';
  end if;
  if v_preset not in ('bold', 'clean', 'minimal') then
    raise exception 'Unsupported caption style.' using errcode = '22023';
  end if;

  if (select count(*) from public.jobs
      where user_id = v_user and status in ('queued', 'running') and purging_at is null) >= 3
  then
    raise exception 'You already have 3 projects in progress. Please wait for one to finish.'
      using errcode = 'P0001';
  end if;

  if not public.rate_limit_hit('jobs', 10, 3600) then
    raise exception 'Too many projects started. Please wait a while and try again.'
      using errcode = 'P0001';
  end if;

  if v_source like 'storage://%' then
    perform public.consume_upload_reservation('sources', substring(v_source from 11), null);
  end if;

  perform 1 from public.profiles where id = v_user for update;
  v_balance := public.credit_balance(v_user);
  if v_balance < v_hold then
    raise exception 'Not enough credits: % needed, % left. Top up on the Credits page.',
      v_hold, v_balance using errcode = 'P0001';
  end if;
  select plan into v_plan from public.profiles where id = v_user;

  insert into public.jobs(
    user_id, source_url, clips_requested, clip_length, watermark, segments,
    mode, aspect, layout, captions, caption_preset
  ) values(
    v_user, v_source, v_clips, v_length, coalesce(v_plan, 'free') = 'free', v_segments,
    v_mode, v_aspect, v_layout, v_captions, v_preset
  ) returning * into v_job;

  perform public.credit_hold(v_user, 'job', v_job.id, v_hold, 'Hold for new job', v_job.id);
  return v_job;
end;
$_$;


commit;
