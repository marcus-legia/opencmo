# Remove the AI CMO's MCP; keep the editor's

Owner decision, 2026-11-14: the CMO tools over MCP are not needed. The editor MCP stays. Sessions:
[`2026-11-14-remove-cmo-mcp-sessions/`](2026-11-14-remove-cmo-mcp-sessions/) (A, B, C, in that order).

Branch `claude/remove-ai-cmo-mcp-plan-5jwr85`, one PR. Base: `main` at `c57a2db`.

## Decisions (owner, 2026-11-14)

- **D1. Remove the CMO, inbox and account groups from the MCP server.** That is the 20 CMO chat tools, the
  `onboard` / `plan-week` / `sales-scan` / `inbox` prompts, the CMO playbook resources, `list_inbox`,
  `get_inbox_item`, `submit_*`, `get_check_rubric` and `get_mode`.
- **D2. Remove "mode B" entirely.** `brain = "claude"` existed only so the founder's own Claude could do the CMO
  thinking over MCP: when a founder had fewer credits than one Assistant turn, or no model provider answered, the
  CMO cron opened a row in `cmo_inbox` instead of calling a model. With the MCP tools gone nobody reads that inbox, so
  every queued task would wait for nothing. After this plan:
  - **Out of credits:** the CMO's model work is not queued. The founder sees the usual top-up path (`PlanSheet` /
    "needs credits"), the same as any other paid step. A scheduled loop for that founder is skipped and counted as
    `waiting`, like a paused account.
  - **Provider down:** the run takes the normal path (failover, then `llm-error` retry and refund). No fallback to the
    founder's Claude.
- **D3. Drop the database objects in a new migration.** Never edit an applied migration. Drop `cmo_inbox`, its RPCs
  and the `mcp_social` / `mcp_site` buckets of `cmo_read_hit`. Strip `brain` from every run input on the SQL side:
  today `cmo_enqueue` charges **0 credits** to a paid founder's run when `input.brain = 'claude'`, and once the inbox is
  gone that becomes a free run with no one else paying for the thinking. Keep the `'mcp'` values of
  `approvals.decided_via` and `work_orders.created_by`: old rows hold them, and the editor MCP still decides through
  `studio` with `caller: "mcp"`.
- **D4. Keep `get_credits` and move it to the editor MCP.** A client running priced editor tools should see the
  balance first. `mediaCreditsShort` (used by `lib/departments/studio/adapter.ts`) moves with it. The text drops
  "Planning and writing in Claude need no credits".
- **D5. Sessions run one after another: A → B → C.** B needs A's deletions to build. C can drop the tables only once
  no code calls them.

## What stays, untouched

The editor MCP and everything it shares: `packages/mcp-server` (server, OAuth, confirm codes, the groups `find`,
`look`, `versions`, `studio`, `generations`, `explainer`, `export`, `guides`), `packages/engine/mcp_app.py`,
`apps/web/lib/mcp/`, API keys (`create_api_key`, `ApiKeys`), OAuth consent, `mcp_grants`, `mcp_admit`, the `'mcp'`
rate-limit bucket, `OPENCMO_MCP_URL`, `OPENCMO_MCP_CONFIRM_KEY`, `ConnectedApps`, `PaidPlanNote`.

`/app/inbox` and `InboxPages` are the **Approvals** inbox, not the Claude inbox: out of scope.
`/api/mcp` (410 "moved") stays: it points old clients at the editor server.

## The audit (what exists today)

| Area | Files | Who removes it |
|---|---|---|
| MCP groups | `packages/mcp-server/src/groups/{cmo,inbox,account}.ts`, `groups/index.ts` (3 imports), `server.check.ts` (cases for those groups), `registry.ts` comment | A |
| CMO tools for MCP | `apps/web/lib/cmo/mcp/` (`cmo.ts`, `inbox.ts`, `inbox.e2e.ts`, `account.ts`, `prompts.ts`, `contract.ts`, `index.ts`, `mcp.check.ts`) | A |
| Imports of `lib/cmo/mcp` | `lib/departments/studio/adapter.ts` (`mediaCreditsShort`), `lib/agent/cmo-live.check.ts`, `cmo-decisions.check.ts`, `cmo-editor.check.ts` (`CMO_TOOLS`), `lib/cmo/capabilities.check.ts` (comment), `apps/web/package.json` (`check:contracts` runs `mcp.check.ts`) | A |
| Mode B engine | `lib/cmo/brain.ts`, `brain.check.ts`, `jobs/think.ts` (`NeedsClaude`), `jobs/runner.ts` (inbox memo, replay, `NOW_KEY`), `jobs/steps.ts` (inbox step table), `jobs/store.ts` (`inbox`, `openInbox`, `finishInbox`, `enqueueDueDrafts({claude})`), `jobs/memory-store.ts`, `jobs/types.ts` (`Brain`, `InboxRequest`), `jobs/start.ts`, `jobs/draft-post.ts`, `jobs/draft-thread.ts`, `jobs/edit-taxonomy.ts` (`founder-claude`), `schedule.ts`, `onboard.ts`, `agent/cmo-tools.ts` (`CmoTurn.brain`, `p_brain`), `jobs/jobs.check.ts`, `writer/writer.check.ts` | B |
| Mode B routes | `app/api/v1/cmo/mode/route.ts` (delete), `app/api/v1/cmo/runs/route.ts` | B |
| Mode B UI | `components/editor/assistant/ContinueInClaude.tsx` (delete) and its two callers (`AssistantPanel.tsx`, `cmo/workspace/ChatPanel.tsx`), `components/today/AgentSales.tsx` ("Send to my Claude"), `screens/settings/SettingsScreen.tsx` ("Who does the thinking"), `lib/screens/common.ts` + `load.ts` (`cmo.mode`), fixtures and e2e that expect it | B |
| SQL | `cmo_inbox` table; `cmo_inbox_max_rounds`, `cmo_inbox_open`, `cmo_inbox_finish`, `inbox_list`, `inbox_claim`, `inbox_submit`; the `brain` branches of `cmo_enqueue` (behind `enqueue_cmo_run`), `cmo_first_draft_after_plan`, `cmo_order_script(p_brain)`; `cmo_read_limit` / `cmo_read_hit` buckets `mcp_social`, `mcp_site` | C |
| pgTAP | `158_cmo_inbox`, `159_cmo_inbox_read_caps` (retire), the `brain` cases of `176_paid_only`, `240_r5_credits`, `272_first_draft_after_plan`, `239_r4_rate_limits` (`mcp_social`), `182_authenticated_function_allowlist` (3 inbox functions) | C |
| Docs and config | `docs/architecture/{brain,approval,workflow,ai-cmo,studio}.{md,html}` (mode B, inbox), `docs/plans/cmo/README.md`, `apps/web/.env.example` (`OPENCMO_BRAIN`, "Connect Claude" note), `lib/ops/switches.ts` text, `CLAUDE.md` if it names the CMO tools | C |

## Order and gates

1. **A** removes the MCP side and moves `get_credits`. Gate: `packages/mcp-server` `npm run check && npm test`,
   `apps/web` `npm run typecheck` and `check:contracts`. The editor tool list is unchanged except that
   `get_credits` now comes from the editor group (the tool list snapshot in `server.check.ts` proves it).
2. **B** removes mode B from the engine, routes and UI. Gate: `typecheck`, `check:contracts` (`jobs.check`,
   `writer.check`, `screens.check`), `build`, the e2e specs it touches. `grep -rn '"claude"' apps/web/lib/cmo` finds no
   brain reference.
3. **C** writes the migration, pgTAP, schema dump and docs. Gate: `npm run db:reset && npm run db:test`,
   `scripts/dump-schema.sh` with a diff limited to this change, `grep -rn "cmo_inbox\|inbox_submit\|mcp_social"` in
   `apps packages supabase/tests` empty.

## Deploy order (for the owner)

The web app and the MCP server deploy separately. Deploy **the MCP server first** (`modal deploy mcp_app.py`): once the
CMO tools are gone from the server, no client can open an inbox item. Then Vercel, then `db push`: the migration drops
RPCs the old web build still calls, so it goes last. Open `cmo_inbox` rows are dropped with the table; their
`cmo_runs` are already `done` (`waiting_for`), so no credit is held for them. C checks that with a query in its
migration notes before the drop.

## Out of scope

- Rewriting the editor MCP, its OAuth or API keys.
- A new "out of credits" screen: B reuses the existing top-up path.
- Removing the `'mcp'` values from CHECK constraints (D3).
