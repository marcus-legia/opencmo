# Remove the CMO MCP: sessions

Plan: [`../2026-11-14-remove-cmo-mcp-plan.md`](../2026-11-14-remove-cmo-mcp-plan.md).

One branch for all three: `claude/remove-ai-cmo-mcp-plan-5jwr85`, one PR. **Sessions run in order: A, then B, then
C** (D5). A session starts only after the one before it has pushed and ticked its list. Each commit is green on its
own for what it touches.

| Session | Owns | Waits on |
|---|---|---|
| [A](A.md) | `packages/mcp-server/src/groups/*`, `server.check.ts`, `registry.ts` comment; `apps/web/lib/cmo/mcp/` (deleted); `apps/web/lib/mcp/credits.ts` (new); the four importers of `lib/cmo/mcp`; the `check:contracts` line in `apps/web/package.json` | nothing |
| [B](B.md) | `apps/web/lib/cmo/{brain,brain.check,schedule,onboard}.ts`, `lib/cmo/jobs/*` (the files listed in B), `lib/agent/cmo-tools.ts`, `app/api/v1/cmo/{mode,runs}`, `ContinueInClaude.tsx` and its callers, `AgentSales.tsx`, `SettingsScreen.tsx`, `lib/screens/{common,load}.ts` and their fixtures and e2e | A pushed |
| [C](C.md) | `supabase/migrations/<new>_remove_cmo_inbox.sql`, `supabase/tests/<new>_remove_cmo_inbox.test.sql`, the changed pgTAP files, `supabase/schema/current.sql`, `docs/architecture/*`, `docs/plans/cmo/README.md`, `apps/web/.env.example`, `lib/ops/switches.ts` text, `CLAUDE.md` | B pushed |

Each session writes "What I ran, what I could not" at the end of its file, as the earlier session files do.
