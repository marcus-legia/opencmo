-- ElevenLabs audio calls ElevenLabs directly instead of fal, and ElevenLabs is the only voice.
--
-- * `elevenlabs-voice`, `elevenlabs-sfx`, `elevenlabs-music` route to provider `elevenlabs`
--   (the direct adapter): ids, names, prices and limits stay, so saved documents and past
--   generations keep working.
-- * `gemini-voice` (Gemini TTS on fal) is turned off. Its row stays for past generations; the
--   web catalog and the worker both skip disabled models, so /video and voiceovers can only
--   pick an ElevenLabs voice.
-- Same values as packages/contracts/ai-models.json.

begin;

update public.ai_models
set provider = 'elevenlabs'
where id in ('elevenlabs-voice', 'elevenlabs-sfx', 'elevenlabs-music');

update public.ai_models
set enabled = false
where id = 'gemini-voice';

commit;
