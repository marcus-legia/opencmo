-- 3D and Lottie are removed from the product (owner, 2026-10-24): motion is made only with Remotion
-- (explainers and motion clips). The `studio-3d` model (three.js scenes on a GPU worker) goes away.
--
-- Production had no `studio-3d` generation when this was written, so the row is deleted, matching
-- packages/contracts/ai-models.json. A database that still holds one (a dev database) keeps the row
-- turned off instead, because `generations.model` references it; nothing can create a new one.
--
-- `scene_codes`, `save_scene_code` and `agent_raise_hold_3d` stay: explainers use them.

begin;

update public.ai_models set enabled = false where id = 'studio-3d';

delete from public.ai_models m
where m.id = 'studio-3d'
  and not exists (select 1 from public.generations g where g.model = m.id);

commit;
