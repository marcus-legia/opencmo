-- Every `public` function a signed-in user (or any OAuth client holding their token) can call
-- through PostgREST, as one fixed list (security plan fix 9).
--
-- A new function is on this surface by default (Postgres grants EXECUTE to PUBLIC). This test
-- fails until it is either listed here — a conscious decision that users may call it directly,
-- with its own ownership checks and limits — or revoked from `authenticated`.
-- Known debt: `create_generation` skips the route's moderation; PR #71's billing work removes it.
create extension if not exists pgtap with schema extensions;

begin;
set search_path to public, extensions;

select plan(2);

create temp table allowed (signature text primary key) on commit drop;
insert into allowed values
  ('account_retention()'),
  ('account_summary()'),
  ('agent_3d_hold_credits()'),
  ('agent_auto_extend(uuid)'),
  ('agent_auto_hold_cap()'),
  ('agent_begin_turn(uuid,text,jsonb)'),
  ('agent_complete_tool(uuid,text,text,jsonb)'),
  ('agent_credits(bigint)'),
  ('agent_extend_credits()'),
  ('agent_extend_hold(uuid)'),
  ('agent_hold_credits()'),
  ('agent_mark_undone(uuid)'),
  ('agent_new_session(uuid,text)'),
  ('agent_open_cmo_session(text,boolean)'),
  ('agent_open_session(uuid,text)'),
  ('agent_pause_turn(uuid,text)'),
  ('agent_raise_hold_3d(uuid)'),
  ('agent_resume_turn(uuid,text,text[])'),
  ('agent_set_checkpoint(uuid,uuid)'),
  ('agent_stop(uuid)'),
  ('ai_check_spec(ai_models,jsonb)'),
  ('ai_price(ai_models,jsonb)'),
  ('auto_transcript_daily_seconds()'),
  ('brand_logo_allows(text)'),
  ('cancel_export(uuid)'),
  ('cancel_generation(uuid)'),
  ('cancel_job(uuid)'),
  ('captions_credits(numeric)'),
  ('captions_max_seconds()'),
  ('capture_create(text)'),
  ('capture_daily_limit()'),
  ('charge_caption_translation(uuid,numeric)'),
  ('check_transcript_body(text)'),
  ('checkpoint_editor_project(uuid,text,text,integer)'),
  ('cmo_add_item(text,text,date,text,jsonb)'),
  ('cmo_as_written()'),
  ('cmo_chat_save_document(text,jsonb)'),
  ('cmo_decide_goal(uuid,text,text,integer)'),
  ('cmo_decide_opportunity(uuid,text,text)'),
  ('cmo_decide_post(uuid,text,text,text)'),
  ('cmo_inbox_max_rounds()'),
  ('cmo_job_daily_limit(text)'),
  ('cmo_job_price(text)'),
  ('cmo_mark_posted(uuid,text)'),
  ('cmo_memories_classify()'),
  ('cmo_read_hit(text)'),
  ('cmo_read_limit(text)'),
  ('cmo_remember(text,text,text)'),
  ('cmo_remove_item(uuid)'),
  ('cmo_set_week_goal(date,text,text,integer)'),
  ('cmo_update_item(uuid,text,date)'),
  ('complete_caption_translation(uuid,text)'),
  ('create_api_key(text)'),
  ('create_blank_edit(text,text)'),
  ('create_upload_edit(text,text,boolean)'),
  ('create_generation(uuid,uuid,text,jsonb,text,uuid)'),
  ('credit_balance(uuid)'),
  ('delete_brand_kit(uuid)'),
  ('delete_editor_skill(text)'),
  ('delete_job(uuid)'),
  ('delete_media_asset(uuid)'),
  ('document_hash(editor_projects)'),
  ('editor_document_hash(jsonb)'),
  ('editor_document_shape_ok(jsonb)'),
  ('enqueue_cmo_run(text,jsonb)'),
  ('finish_cmo_run(uuid,boolean,text)'),
  ('generation_active_limit()'),
  ('get_or_create_editor_project(uuid,jsonb,jsonb)'),
  ('handle_new_user()'),
  ('inbox_claim(uuid)'),
  ('inbox_list()'),
  ('inbox_submit(uuid,uuid,text,jsonb)'),
  ('is_paid(uuid)'),
  ('job_hold_credits()'),
  ('list_projects(timestamp with time zone,uuid,text,integer)'),
  ('mcp_admit(integer)'),
  ('mcp_confirm_use(uuid)'),
  ('mcp_grant_record(text)'),
  ('mcp_grant_revoke(text)'),
  ('normalize_capture_url(text)'),
  ('purge_in_progress()'),
  ('put_editor_transcript(uuid,text)'),
  ('rate_limit_hit(text,integer,integer)'),
  ('refund_caption_translation(uuid)'),
  ('refund_media_captions_from_task()'),
  ('register_media_asset(uuid,text,text,uuid)'),
  ('rename_blank_edit(uuid,text)'),
  ('rename_project(uuid,text)'),
  ('request_document_export(uuid,uuid,uuid,integer)'),
  ('request_media_captions(uuid,uuid,numeric,numeric,uuid)'),
  ('request_media_transcript(uuid)'),
  ('reserve_upload(text,text,bigint,text,uuid)'),
  ('reset_editor_project(uuid,integer)'),
  ('retry_job(uuid)'),
  ('revoke_api_key(uuid)'),
  ('save_brand_kit(uuid,text,jsonb)'),
  ('save_editor_document(uuid,integer,jsonb,jsonb)'),
  ('save_editor_skill(text,text,text)'),
  ('save_marketing_document(text,jsonb,uuid)'),
  ('save_scene_code(text)'),
  ('send_feedback(text,text,text,text,uuid)'),
  ('set_default_brand_kit(uuid)'),
  ('set_project_pinned(uuid,boolean)'),
  ('signup_credits()'),
  ('slice_transcript(jsonb,numeric,numeric)'),
  ('snapshot_editor_revision(uuid,text)'),
  ('snapshot_editor_variant(uuid,text,jsonb,text)'),
  ('start_cmo_run(text,jsonb)'),
  ('upload_reservation_allows(text,text,jsonb)'),
  ('upload_usage()'),
  ('use_media_transcript(uuid,uuid,numeric,numeric)');

create temp table callable on commit drop as
select p.oid::regprocedure::text as signature
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');

select is_empty(
  $$ select signature from callable except select signature from allowed order by 1 $$,
  'no function is callable by authenticated without an entry here'
);
select is_empty(
  $$ select signature from allowed except select signature from callable order by 1 $$,
  'every entry here is still callable (drop stale entries)'
);

select * from finish();
rollback;
