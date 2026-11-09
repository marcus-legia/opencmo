-- Prices for fal and ElevenLabs spend (cmo-review-2 S3.3).
--
-- The worker records each paid media generation as `<model id>:<unit>` (opencmo/ai/spend.py, media_units), and until
-- now every such row was stored unpriced: the Costs page counted calls but no dollars. These are the providers' list
-- prices as published on 2026-11-08, per the unit the worker records:
--
-- * `second` models: the price of one second of video, without model audio (the worker turns it off unless the spec
--   asks for it; with audio Veo costs about twice as much, so such a call is undercounted).
-- * ElevenLabs sound effects and music are recorded once per `generation`: the row is the price of the longest one the
--   catalogue allows (22 s of effects, 60 s of music), so the ledger never shows less than was spent.
--
-- Every row is PROVISIONAL until checked against an invoice (owner). Models whose price was not found stay unpriced on
-- purpose (the ledger never guesses): gemini-voice (fal Gemini TTS), fal-kling-edit, fal-seedvr-upscale,
-- fal-veed-cutout. A price test adds a row with a later valid_from; stored rows keep the price they were recorded with.

begin;

insert into public.provider_prices (provider, unit, micro_usd, valid_from, note)
select provider, unit, micro_usd, timestamptz '2026-11-08 00:00:00+00', note
from (values
  ('fal', 'gemini-image:generation', 39800, 'PROVISIONAL: fal nano-banana, $0.0398 an image (2026-11-08)'),
  ('fal', 'fal-nano-banana:generation', 39800, 'PROVISIONAL: fal nano-banana, $0.0398 an image (2026-11-08)'),
  ('fal', 'fal-seedream:generation', 30000, 'PROVISIONAL: fal Seedream 4, $0.03 an image (2026-11-08)'),
  ('fal', 'gemini-video:second', 100000, 'PROVISIONAL: fal Veo 3.1 Fast, $0.10 a second without audio (2026-11-08)'),
  ('fal', 'fal-veo:second', 200000, 'PROVISIONAL: fal Veo 3.1, $0.20 a second without audio (2026-11-08)'),
  ('fal', 'fal-kling-v3:second', 112000, 'PROVISIONAL: fal Kling 3 Pro, $0.112 a second without audio (2026-11-08)'),
  ('fal', 'fal-kling:second', 280000, 'PROVISIONAL: fal Kling 2.1 Master, $1.40 for 5 s (2026-11-08)'),
  ('fal', 'fal-hailuo:second', 45000, 'PROVISIONAL: fal Hailuo 02 Standard, $0.045 a second (2026-11-08)'),
  ('fal', 'fal-seedance:second', 36000, 'PROVISIONAL: fal Seedance Lite, $0.18 for 5 s at 720p, the dearer size (2026-11-08)'),
  ('elevenlabs', 'elevenlabs-voice:kchars', 80000, 'PROVISIONAL: ElevenLabs Multilingual v2 API, $0.08 per 1,000 characters (2026-11-08)'),
  ('elevenlabs', 'elevenlabs-sfx:generation', 44000, 'PROVISIONAL: ElevenLabs sound effects, $0.002 a second, priced at the 22 s maximum (2026-11-08)'),
  ('elevenlabs', 'elevenlabs-music:generation', 150000, 'PROVISIONAL: ElevenLabs music, $0.15 a minute, priced at the 60 s maximum (2026-11-08)')
) as prices (provider, unit, micro_usd, note)
-- A no-op where a row for that unit and date already exists (a rerun, or a row the owner added by hand).
where not exists (
  select 1 from public.provider_prices existing
  where existing.provider = prices.provider and existing.unit = prices.unit and existing.valid_from = timestamptz '2026-11-08 00:00:00+00'
);

commit;
