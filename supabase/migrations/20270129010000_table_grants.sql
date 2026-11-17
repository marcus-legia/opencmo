-- Web hardening round 4, session A: anon and authenticated hold only the table rights the app uses.
-- Plan: docs/plans/engineering/2026-11-17-web-hardening-round-4-plan-sessions/a-table-grants.md
--
-- Why: about 40 `public` tables still carried Supabase's old default grants (select, insert, update, delete,
-- truncate, references, trigger) to anon and authenticated, so RLS was the only guard. One table with RLS switched
-- off, or one permissive policy, and the table opened to the public anon key; TRUNCATE ignores RLS altogether.
-- Every write goes through a SECURITY DEFINER RPC (web rule 1), which runs as its owner and needs no grant here.
--
-- Measured before (local, every migration applied, 2026-11-17), grants in `public` per privilege:
--   anon:          select 37, references 37, trigger 37, truncate 37, insert 21, delete 21, update 20; usage on 5 sequences
--   authenticated: select 66, references 38, trigger 38, truncate 37, insert 21, delete 21, update 20; usage on 5 sequences
--   default privileges of postgres in public: tables arwdDxtm and sequences rwU to both roles.
-- After: anon select on 1 table; authenticated select on 56 tables and views (+ 7 api_keys columns); no sequence; no
-- default grant from postgres.
--
-- What the app reads, per object. Every row is a SELECT through a user's session client (server components, route
-- handlers, browser code) or the MCP server's short-lived user JWT, both of which run as `authenticated`. "rt" marks
-- a Realtime `postgres_changes` subscription (the subscriber needs select). The service-role client and the engine
-- need no grant. Found by scanning every `.from("<table>")` in apps/web and packages/mcp-server and its receiver.
--
--   object                        anon    authenticated  proof
--   account_metrics               -       select         apps/web/lib/screens/load.ts
--   agent_messages                -       select         apps/web/lib/agent/loop.ts
--   agent_sessions                -       select         apps/web/lib/agent/session.ts
--   agent_tool_calls              -       select         apps/web/lib/agent/loop.ts
--   agent_turn_ratings            -       select         apps/web/lib/agent/view.ts
--   agent_turns                   -       select         apps/web/app/api/v1/agent/sessions/route.ts
--   agent_usage                   -       select         apps/web/lib/agent/loop.ts
--   ai_models                     -       select         apps/web/lib/generate/models.ts
--   api_keys (7 columns, no hash) -       select         apps/web/app/api/v1/api-keys/route.ts
--   approvals (rt)                -       select         apps/web/app/api/v1/approvals/[id]/route.ts, components/dashboard/useDashboard.ts
--   artifacts                     -       select         apps/web/lib/api/projects.ts
--   best_slots                    -       select         apps/web/lib/screens/schedule-enrich.ts
--   billing_catalog               select  select         anon: apps/web/lib/billing-catalog.ts (landing prices, signed out) and
--                                                        lib/ops/health.ts (probeDatabase reads it with the anon key);
--                                                        authenticated: app/api/v1/billing/checkout/route.ts
--   brand_kits                    -       select         apps/web/app/api/v1/brand-kits/route.ts
--   clips (rt)                    -       select         apps/web/app/api/v1/clips/[id]/file/route.ts, components/clipping/web/ProjectView.tsx
--   cmo_corrections               -       select         apps/web/lib/cmo/voice.ts
--   cmo_draft_outcomes            -       select         apps/web/lib/screens/load.ts
--   cmo_draft_ratings             -       select         apps/web/lib/cmo/voice.ts
--   cmo_goals                     -       select         apps/web/lib/cmo/load-workspace.ts
--   cmo_insights                  -       select         apps/web/lib/agent/cmo-tools.ts
--   cmo_lessons                   -       select         apps/web/lib/agent/cmo-tools.ts
--   cmo_memories                  -       select         apps/web/lib/agent/cmo-tools.ts
--   cmo_runs (rt)                 -       select         apps/web/app/api/v1/cmo/onboarding/route.ts, components/cmo/workspace/ChatPanel.tsx
--   cmo_voice_events              -       select         apps/web/lib/cmo/voice.ts
--   content_items                 -       select         apps/web/lib/agent/cmo-decisions.ts
--   credit_ledger                 -       select         apps/web/app/api/v1/logs/route.ts, app/app/billing/page.tsx
--   credit_orders                 -       select         apps/web/lib/agent/explainer-tool.ts
--   deliverables                  -       select         apps/web/lib/screens/load.ts
--   editor_projects               -       select         apps/web/app/api/v1/editor/clips/route.ts
--   editor_revisions              -       select         apps/web/app/api/v1/editor/revisions/route.ts
--   editor_skills                 -       select         apps/web/lib/agent/skills.ts, packages/mcp-server/src/groups/guides.ts
--   editor_transcripts            -       select         apps/web/app/api/v1/editor/transcript/route.ts
--   generations (rt)              -       select         apps/web/app/api/v1/generations/[id]/route.ts, components/editor/generate/useGenerations.ts
--   jobs (rt)                     -       select         apps/web/app/api/v1/editor/clips/route.ts, components/clipping/useLive.ts
--   marketing_documents           -       select         apps/web/app/app/page.tsx; base table of the view below
--   marketing_documents_latest    -       select         apps/web/lib/cmo/state.ts (security_invoker view: needs its base table too)
--   mcp_grants                    -       select         apps/web/components/clipping/web/ConnectedApps.tsx, packages/mcp-server/src/oauth.ts
--   media_assets                  -       select         apps/web/app/api/v1/projects/[id]/media/route.ts
--   media_transcripts             -       select         apps/web/lib/agent/captions-tool.ts
--   notify_settings               -       select         apps/web/app/api/v1/notify/route.ts
--   opportunities                 -       select         apps/web/lib/agent/cmo-tools.ts
--   page_captures                 -       select         apps/web/lib/capture/index.ts
--   photo_posts                   -       select         apps/web/app/api/v1/photo-posts/[id]/route.ts
--   post_metrics                  -       select         apps/web/lib/cmo/load-workspace.ts
--   post_variants                 -       select         apps/web/lib/screens/schedule-enrich.ts
--   profiles                      -       select         apps/web/app/api/v1/billing/checkout/route.ts
--   sales_settings                -       select         apps/web/lib/agent/cmo-decisions.ts
--   schedule_slots (rt)           -       select         apps/web/lib/screens/load.ts, components/today/Feed.tsx
--   short_batches                 -       select         apps/web/lib/screens/load.ts
--   shorts                        -       select         apps/web/lib/screens/load.ts
--   social_accounts               -       select         apps/web/app/api/v1/accounts/route.ts
--   studio_steps                  -       select         apps/web/lib/departments/studio/steps.ts
--   tasks                         -       select         apps/web/app/api/v1/editor/captions/route.ts
--   work_order_events             -       select         apps/web/app/api/v1/logs/route.ts
--   work_orders                   -       select         apps/web/app/api/v1/cmo/scripts/route.ts
--   zernio_profiles               -       select         apps/web/lib/departments/publish/accounts-store.ts (user client, connect routes)
--
-- Lose authenticated select although a SELECT policy exists, because no user client reads them (only the service
-- role or SECURITY DEFINER RPCs do): caption_translations, card_budget, editor_feedback, email_log, look_checks,
-- operation_log, projects, push_subscriptions, scene_codes, subreddit_rules, work_order_usage. Their policies stay:
-- harmless without a grant, and a later reader only needs the grant.
-- Lose everything: every other table, the views activation and cmo_draft_quality_weekly (already had none), and
-- every sequence (only RPCs insert, as their owner).
-- Direct writes from a user client: none found (every .insert/.update/.upsert/.delete on a table is the service role).
--
-- Default privileges: tables and sequences that postgres (the role that runs our migrations) creates in `public`
-- grant nothing to anon or authenticated. service_role keeps its default. supabase_admin's own defaults in `public`
-- cannot be changed from here (postgres is not a member of it) and only apply to objects supabase_admin creates,
-- which our migrations never do; supabase/tests/323_table_grants lists every grant anyway, whoever created the object.
-- Functions are out of scope: supabase/tests/182_authenticated_function_allowlist lists them.
-- storage, auth and realtime are not touched.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

grant select on public.billing_catalog to anon;

grant select on
  public.account_metrics,
  public.agent_messages,
  public.agent_sessions,
  public.agent_tool_calls,
  public.agent_turn_ratings,
  public.agent_turns,
  public.agent_usage,
  public.ai_models,
  public.approvals,
  public.artifacts,
  public.best_slots,
  public.billing_catalog,
  public.brand_kits,
  public.clips,
  public.cmo_corrections,
  public.cmo_draft_outcomes,
  public.cmo_draft_ratings,
  public.cmo_goals,
  public.cmo_insights,
  public.cmo_lessons,
  public.cmo_memories,
  public.cmo_runs,
  public.cmo_voice_events,
  public.content_items,
  public.credit_ledger,
  public.credit_orders,
  public.deliverables,
  public.editor_projects,
  public.editor_revisions,
  public.editor_skills,
  public.editor_transcripts,
  public.generations,
  public.jobs,
  public.marketing_documents,
  public.marketing_documents_latest,
  public.mcp_grants,
  public.media_assets,
  public.media_transcripts,
  public.notify_settings,
  public.opportunities,
  public.page_captures,
  public.photo_posts,
  public.post_metrics,
  public.post_variants,
  public.profiles,
  public.sales_settings,
  public.schedule_slots,
  public.short_batches,
  public.shorts,
  public.social_accounts,
  public.studio_steps,
  public.tasks,
  public.work_order_events,
  public.work_orders,
  public.zernio_profiles
to authenticated;

-- The key hash never leaves the database: the same columns the key list had before (revoke all took them away).
grant select (id, user_id, name, prefix, created_at, last_used_at, revoked_at) on public.api_keys to authenticated;
