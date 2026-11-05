-- Charge before running (plan 2026-11-06, phase 4): /video makes its keyframes, shots, voice-over and music in one
-- go after one confirmation, so a whole long take is in flight at once. The longest one (18 shots, 19 keyframes, a
-- voice-over and a music bed) is 39 generations; 24 refused any video over about 50 seconds. Every one of them is
-- paid from the job's hold before it starts, so the cap guards load, not money.
create or replace function public.generation_active_limit() RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$ select 40 $$;
