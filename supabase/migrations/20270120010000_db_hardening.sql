-- Database hardening from the 2026-11-13 database review: operations and least privilege. No behaviour changes.
--
-- 1. An index on every foreign key that a delete follows. Without one, each deleted parent row scans the whole child
--    table: purge_expired_jobs (jobs -> tasks, worker_operations, upload_reservations), deleting an unpaid account
--    (auth.users -> agent_sessions, media_transcripts, ...) and deleting a CMO run (set null on six tables) get
--    slower as those tables grow, until the cleanup cron or a founder's delete hits its statement timeout.
-- 2. Two indexes that duplicate a unique constraint: every write paid for both.
-- 3. anon and authenticated lose the table and sequence privileges they never use. Every write goes through a
--    security definer RPC (web rule 1) and no table has a write policy, so INSERT/UPDATE/DELETE were already refused
--    by RLS. TRUNCATE is not covered by RLS at all. New tables stop getting them by default.
--
-- Fail fast instead of queueing behind a long transaction: a waiting CREATE INDEX blocks every later write on the
-- table. If this times out in production, rerun it at a quiet hour; every statement is idempotent.
set local lock_timeout = '5s';

-- 1. Foreign keys followed by a delete or an ownership join. generations.model -> ai_models is left out: the catalogue
-- is a handful of rows and a model is never deleted while generations point at it.
create index if not exists tasks_job_id_idx on public.tasks (job_id) where job_id is not null;
create index if not exists tasks_clip_id_idx on public.tasks (clip_id) where clip_id is not null;
create index if not exists tasks_asset_id_idx on public.tasks (asset_id) where asset_id is not null;
create index if not exists worker_operations_job_id_idx on public.worker_operations (job_id);
create index if not exists upload_reservations_project_id_idx on public.upload_reservations (project_id);
create index if not exists agent_sessions_user_id_idx on public.agent_sessions (user_id);
create index if not exists agent_turns_checkpoint_id_idx on public.agent_turns (checkpoint_id) where checkpoint_id is not null;
create index if not exists agent_messages_turn_id_idx on public.agent_messages (turn_id);
create index if not exists agent_usage_turn_id_idx on public.agent_usage (turn_id);
create index if not exists generations_media_asset_id_idx on public.generations (media_asset_id) where media_asset_id is not null;
create index if not exists generations_clip_id_idx on public.generations (clip_id) where clip_id is not null;
create index if not exists content_items_run_id_idx on public.content_items (run_id) where run_id is not null;
create index if not exists cmo_memories_source_run_idx on public.cmo_memories (source_run) where source_run is not null;
create index if not exists opportunities_run_id_idx on public.opportunities (run_id) where run_id is not null;
create index if not exists cmo_insights_run_id_idx on public.cmo_insights (run_id) where run_id is not null;
create index if not exists cmo_lessons_run_id_idx on public.cmo_lessons (run_id) where run_id is not null;
create index if not exists cmo_goals_run_id_idx on public.cmo_goals (run_id) where run_id is not null;
create index if not exists cmo_inbox_run_id_idx on public.cmo_inbox (run_id) where run_id is not null;
create index if not exists editor_feedback_user_id_idx on public.editor_feedback (user_id);
create index if not exists editor_feedback_clip_id_idx on public.editor_feedback (clip_id) where clip_id is not null;
create index if not exists caption_translations_clip_id_idx on public.caption_translations (clip_id);
create index if not exists media_transcripts_user_id_idx on public.media_transcripts (user_id);
create index if not exists work_orders_parent_id_idx on public.work_orders (parent_id) where parent_id is not null;
create index if not exists deliverables_user_id_idx on public.deliverables (user_id);
create index if not exists work_order_events_order_id_idx on public.work_order_events (order_id);
create index if not exists studio_steps_redo_of_idx on public.studio_steps (redo_of) where redo_of is not null;
create index if not exists short_batches_order_id_idx on public.short_batches (order_id) where order_id is not null;
create index if not exists shorts_parent_clip_id_idx on public.shorts (parent_clip_id) where parent_clip_id is not null;
create index if not exists work_order_usage_user_id_idx on public.work_order_usage (user_id);
create index if not exists schedule_slots_account_id_idx on public.schedule_slots (account_id) where account_id is not null;
create index if not exists schedule_slots_media_task_id_idx on public.schedule_slots (media_task_id) where media_task_id is not null;
create index if not exists schedule_slots_approval_id_idx on public.schedule_slots (approval_id) where approval_id is not null;
create index if not exists account_metrics_social_account_id_idx on public.account_metrics (social_account_id) where social_account_id is not null;
create index if not exists look_checks_order_id_idx on public.look_checks (order_id) where order_id is not null;
create index if not exists look_checks_user_id_idx on public.look_checks (user_id);
create index if not exists creem_customers_user_id_idx on public.creem_customers (user_id) where user_id is not null;
create index if not exists creem_webhook_receipts_user_id_idx on public.creem_webhook_receipts (user_id) where user_id is not null;
create index if not exists cmo_voice_events_correction_id_idx on public.cmo_voice_events (correction_id) where correction_id is not null;
create index if not exists cmo_voice_events_document_id_idx on public.cmo_voice_events (document_id) where document_id is not null;

-- 2. Same columns as cmo_goals_user_id_week_key and editor_revisions_clip_id_number_key.
drop index if exists public.cmo_goals_user_idx;
drop index if exists public.editor_revisions_clip_number_idx;

-- 3. Least privilege for the API roles. authenticated keeps SELECT: RLS decides what each founder reads, and realtime
-- needs it. anon reads only the price list; with SELECT on the other tables, GraphQL introspection showed it their
-- columns. Column-level grants, if any, are untouched. service_role keeps everything (webhooks, crons, the worker).
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke select on all tables in schema public from anon;
grant select on public.billing_catalog to anon;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
