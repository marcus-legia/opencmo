-- Long take, Task 1 (docs/plans/editor/2026-10-23-ai-long-take-plan.md): the two first-and-last-frame rows
-- the long take joins keyframes with. The best-looking one is the default; the square one covers the 1:1 frame
-- the first cannot make. Same values as packages/contracts/ai-models.json (check:pricing compares them).
-- `ai_check_spec` already accepts `endImage` on any row with `lastFrame`, and `ai_price` prices `second` rows, so
-- only the rows are new. Prices PROVISIONAL until the first real call: 4x the provider's price without audio.

begin;

insert into public.ai_models (id, kind, provider, name, price, limits) values
  ('fal-veo', 'video', 'fal', 'Cinematic', '{"unit":"second","credits":4}',
   '{"maxPromptChars":2000,"aspectRatios":["9:16","16:9"],"durations":[4,6,8],"resolutions":["720p","1080p"],"firstFrame":true,"lastFrame":true,"providerInputs":{"start":"first_frame_url","end":"last_frame_url"},"silent":true,"typicalSeconds":120}'),
  ('fal-kling-v3', 'video', 'fal', 'Cinematic square', '{"unit":"second","credits":3}',
   '{"maxPromptChars":2500,"aspectRatios":["16:9","9:16","1:1"],"durations":[3,4,5,6,7,8,9,10,11,12,13,14,15],"firstFrame":true,"lastFrame":true,"providerInputs":{"start":"start_image_url","end":"end_image_url"},"silent":true,"typicalSeconds":180}')
on conflict (id) do nothing;

commit;
