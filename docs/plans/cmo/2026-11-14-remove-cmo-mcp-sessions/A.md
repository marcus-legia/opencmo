# Session A: the MCP server loses the CMO groups

Plan: [`../2026-11-14-remove-cmo-mcp-plan.md`](../2026-11-14-remove-cmo-mcp-plan.md) D1, D4.
Rules: [`README.md`](README.md).

**Owns:** `packages/mcp-server/src/groups/{cmo,inbox,account,index}.ts`, a new editor group file for credits,
`packages/mcp-server/src/server.check.ts`, the comment in `registry.ts`; `apps/web/lib/cmo/mcp/` (whole folder);
`apps/web/lib/mcp/credits.ts` (new); `apps/web/lib/departments/studio/adapter.ts` (one import);
`apps/web/lib/agent/{cmo-live,cmo-decisions,cmo-editor}.check.ts`; the comment in `lib/cmo/capabilities.check.ts`;
the `mcp.check.ts` entry of `check:contracts` in `apps/web/package.json`.

**Do not touch** mode B (`brain.ts`, `think.ts`, runner, schedule, `cmo_inbox`): that is B and C. After A the engine
can still open inbox rows. That is fine for one commit range, because nothing deploys between sessions.

- [ ] A1. Move credits to the editor side. Create `apps/web/lib/mcp/credits.ts` with `balance`, `mediaCreditsShort`
  and the `get_credits` tool body from `lib/cmo/mcp/account.ts`. Drop the sentence "Planning and writing in Claude need
  no credits." and the "thinking in Claude does not" clause in the description. `get_mode` and `modeText` are not
  moved: they go with mode B.
- [ ] A2. Register `get_credits` in an editor group: new `packages/mcp-server/src/groups/credits.ts`, imported in
  `groups/index.ts` where `account` was. It uses the registry's `McpTool` type directly (no `CmoMcpTool`).
- [ ] A3. Point `lib/departments/studio/adapter.ts` at `@/lib/mcp/credits`.
- [ ] A4. `cmo-live.check.ts`, `cmo-decisions.check.ts`, `cmo-editor.check.ts` import `CMO_TOOLS` only to check that
  some tools are hidden from MCP. Delete those assertions, keep the rest of each check. Read each one first: if a
  check exists only for MCP, say so in the PR and delete that block.
- [ ] A5. Delete `packages/mcp-server/src/groups/{cmo,inbox,account}.ts` and their imports. Update the header comment
  of `groups/index.ts` and `registry.ts` (no "Session B" groups any more).
- [ ] A6. Delete `apps/web/lib/cmo/mcp/` and the `lib/cmo/mcp/mcp.check.ts` entry in `check:contracts`. Check whether
  `inbox.e2e.ts` is listed in any script or Playwright config and remove that entry too.
- [ ] A7. `server.check.ts`: remove the cases for the CMO, inbox and account tools, prompts and resources. Add one
  case: `tools/list` has `get_credits` and none of `create_task`, `list_inbox`, `get_mode`, `read_cmo_playbook`;
  `prompts/list` has no `onboard`, `plan-week`, `sales-scan` or `inbox`.
- [ ] A8. `lib/cmo/capabilities.check.ts` line ~202: the comment says MCP shares this file. Fix it to "the CMO chat".

## Gate

`cd packages/mcp-server && npm run check && npm test`; `cd apps/web && npm run typecheck && npm run check:contracts`.
Then `grep -rn "lib/cmo/mcp" apps packages` returns nothing.

## What I ran, what I could not

(filled in by the session)
