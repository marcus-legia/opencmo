-- Web hardening round 3, session A: production's Supabase advisors clean (read 2026-11-17).
-- Plan: docs/plans/engineering/2026-11-17-web-hardening-round-3-plan-sessions/a-database.md
--
-- What this changes, by advisor lint:
--   auth_rls_initplan (8)          policies call auth.uid() once per query, not once per row; so do the last
--                                  two storage.objects policies that still called it per row (the advisor reads
--                                  `public` only, but storage.objects holds a row per file of every user).
--   function_search_path_mutable   22 constant functions get `search_path = ''` (bodies use only pg_catalog).
--   anon/authenticated executable  the three trigger functions are no longer callable through /rest/v1/rpc.
--   unindexed_foreign_keys (39)    38 covering indexes; one skipped (below). Two more keys the advisor counts as
--                                  covered only have a partial index (generations.job_id, schedule_slots.
--                                  deliverable_id); a cascade delete cannot use it, so they get a plain one.
--   no_primary_key (1)             write_budget_ledger gets an identity primary key.
--   least privilege                three service-role-only tables (RLS on, no policy) lose their old default
--                                  grants to anon/authenticated, TRUNCATE included (TRUNCATE ignores RLS).
--
-- Kept on purpose:
--   email_unsubscribe(uuid) stays callable by anon: it is the unsubscribe link's target. It only turns the
--     digest off on the one row whose unsubscribe_token (random uuid, unique) matches, and returns true either
--     way, so it reveals nothing and cannot touch another row without that row's token.
--   rls_auto_enable() is not in our migrations (created on production outside them): an owner step.
--   authenticated_security_definer_function_executable (144): the intended RPC surface, listed one by one in
--     supabase/tests/182_authenticated_function_allowlist.test.sql.
--   rls_enabled_no_policy (19): service-role only by design; supabase/tests/321_* lists them.
--   unused_index (15): none dropped. The database is two months old and most features have few users, so "never
--     used" says little yet. Re-read the list on 2027-01-15.
--
-- Foreign key indexes. Row counts on production (pg_stat_user_tables, 2026-11-17): agent_messages 160,
-- work_order_events 93, agent_usage 78, content_items 48, work_orders 37, agent_turns 29, deliverables 18,
-- opportunities 16, cmo_memories 16, agent_sessions 10, cmo_lessons 9, schedule_slots 9, write_budget_ledger 8,
-- account_metrics 6, cmo_goals 5, cmo_voice_events 3, tasks 2, everything else 0 or 1. All tiny, so a plain
-- `create index` inside the migration's transaction locks each table for milliseconds; no `concurrently`.
-- Every indexed key is walked by a delete: account deletion cascades or nulls every user_id; deleting a run,
-- job, clip, order, turn, asset, account, approval, correction or document cascades or nulls its children;
-- and run_id / job_id / order_id / turn_id are the join keys of the run, job and order pages.
-- Skipped: generations.model -> ai_models(id) (no action). ai_models is the model catalogue: its rows are
-- retired, never deleted, and no query filters generations by model.

-- auth_rls_initplan: same names, commands and roles (alter policy keeps them); only the expression changes.
alter policy "đọc job của chính mình" on public.jobs
  using (((select auth.uid()) = user_id) and (purging_at is null));
alter policy "đọc clip thuộc job của mình" on public.clips
  using (exists (select 1 from public.jobs j
                 where j.id = clips.job_id and j.user_id = (select auth.uid()) and j.purging_at is null));
alter policy "đọc code cảnh của mình" on public.scene_codes using (user_id = (select auth.uid()));
alter policy "đọc skill của mình" on public.editor_skills using (user_id = (select auth.uid()));
alter policy "đọc phản hồi của mình" on public.editor_feedback using (user_id = (select auth.uid()));
alter policy mcp_grants_select_own on public.mcp_grants using (user_id = (select auth.uid()));
alter policy "read own order usage" on public.work_order_usage using (user_id = (select auth.uid()));
alter policy credit_orders_own on public.credit_orders using (user_id = (select auth.uid()));
alter policy "đọc file trong thư mục của mình" on storage.objects
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = ((select auth.uid()))::text);
alter policy "đọc file nguồn trong thư mục của mình" on storage.objects
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = ((select auth.uid()))::text);

-- function_search_path_mutable: every body is a constant or uses only built-ins (coalesce, greatest, ceil,
-- current_setting, jsonb functions), which pg_catalog always resolves. No body changes.
alter function public.agent_extend_credits() set search_path = '';
alter function public.auto_transcript_daily_seconds() set search_path = '';
alter function public.autopilot_min_window() set search_path = '';
alter function public.caption_profiles() set search_path = '';
alter function public.captions_credits(numeric) set search_path = '';
alter function public.captions_max_seconds() set search_path = '';
alter function public.capture_daily_limit() set search_path = '';
alter function public.check_transcript_body(text) set search_path = '';
alter function public.cmo_as_written() set search_path = '';
alter function public.cmo_brain_started(jsonb) set search_path = '';
alter function public.cmo_free_onboard_runs() set search_path = '';
alter function public.cmo_job_daily_limit(text) set search_path = '';
alter function public.cmo_job_price(text) set search_path = '';
alter function public.cmo_read_limit(text) set search_path = '';
alter function public.cmo_video_seconds() set search_path = '';
alter function public.purge_in_progress() set search_path = '';
alter function public.signup_credits() set search_path = '';
alter function public.studio_video_budget() set search_path = '';
alter function public.voice_note_cap() set search_path = '';
alter function public.voice_note_days() set search_path = '';
alter function public.write_budget_bytes() set search_path = '';
alter function public.write_budget_rows(text) set search_path = '';

-- Trigger functions: Postgres checks EXECUTE only when a trigger is created, never when it fires, so the
-- triggers keep working. Revoked, they can no longer be called as /rest/v1/rpc/<name>.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.refund_media_captions_from_task() from public, anon, authenticated;
revoke execute on function public.cmo_memories_classify() from public, anon, authenticated;

-- Least privilege: these three are read and written only by the service role and security definer functions.
revoke all on table public.agent_model_prices from anon, authenticated;
revoke all on table public.rate_limits from anon, authenticated;
revoke all on table public.worker_operations from anon, authenticated;

-- no_primary_key: rows have no natural key (one user can write the same table twice in the same instant),
-- and enforce_write_budget() inserts named columns, so a new identity column breaks no insert.
alter table public.write_budget_ledger add column if not exists id bigint generated always as identity;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.write_budget_ledger'::regclass and contype = 'p') then
    alter table public.write_budget_ledger add constraint write_budget_ledger_pkey primary key (id);
  end if;
end $$;

-- unindexed_foreign_keys.
create index if not exists account_metrics_social_account_id_idx on public.account_metrics (social_account_id);
create index if not exists agent_messages_turn_id_idx on public.agent_messages (turn_id);
create index if not exists agent_sessions_user_id_idx on public.agent_sessions (user_id);
create index if not exists agent_turns_checkpoint_id_idx on public.agent_turns (checkpoint_id);
create index if not exists agent_usage_turn_id_idx on public.agent_usage (turn_id);
create index if not exists caption_translations_clip_id_idx on public.caption_translations (clip_id);
create index if not exists cmo_goals_run_id_idx on public.cmo_goals (run_id);
create index if not exists cmo_insights_run_id_idx on public.cmo_insights (run_id);
create index if not exists cmo_lessons_run_id_idx on public.cmo_lessons (run_id);
create index if not exists cmo_memories_source_run_idx on public.cmo_memories (source_run);
create index if not exists cmo_voice_events_correction_id_idx on public.cmo_voice_events (correction_id);
create index if not exists cmo_voice_events_document_id_idx on public.cmo_voice_events (document_id);
create index if not exists content_items_run_id_idx on public.content_items (run_id);
create index if not exists creem_customers_user_id_idx on public.creem_customers (user_id);
create index if not exists creem_webhook_receipts_user_id_idx on public.creem_webhook_receipts (user_id);
create index if not exists deliverables_user_id_idx on public.deliverables (user_id);
create index if not exists editor_feedback_clip_id_idx on public.editor_feedback (clip_id);
create index if not exists editor_feedback_user_id_idx on public.editor_feedback (user_id);
create index if not exists generations_job_id_idx on public.generations (job_id);
create index if not exists schedule_slots_deliverable_id_idx on public.schedule_slots (deliverable_id);
create index if not exists generations_clip_id_idx on public.generations (clip_id);
create index if not exists generations_media_asset_id_idx on public.generations (media_asset_id);
create index if not exists look_checks_order_id_idx on public.look_checks (order_id);
create index if not exists look_checks_user_id_idx on public.look_checks (user_id);
create index if not exists media_transcripts_user_id_idx on public.media_transcripts (user_id);
create index if not exists opportunities_run_id_idx on public.opportunities (run_id);
create index if not exists schedule_slots_account_id_idx on public.schedule_slots (account_id);
create index if not exists schedule_slots_approval_id_idx on public.schedule_slots (approval_id);
create index if not exists schedule_slots_media_task_id_idx on public.schedule_slots (media_task_id);
create index if not exists short_batches_order_id_idx on public.short_batches (order_id);
create index if not exists shorts_parent_clip_id_idx on public.shorts (parent_clip_id);
create index if not exists studio_steps_redo_of_idx on public.studio_steps (redo_of);
create index if not exists tasks_asset_id_idx on public.tasks (asset_id);
create index if not exists tasks_clip_id_idx on public.tasks (clip_id);
create index if not exists tasks_job_id_idx on public.tasks (job_id);
create index if not exists upload_reservations_project_id_idx on public.upload_reservations (project_id);
create index if not exists work_order_events_order_id_idx on public.work_order_events (order_id);
create index if not exists work_order_usage_user_id_idx on public.work_order_usage (user_id);
create index if not exists work_orders_parent_id_idx on public.work_orders (parent_id);
create index if not exists worker_operations_job_id_idx on public.worker_operations (job_id);
