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

- [x] A1. Move credits to the editor side. Create `apps/web/lib/mcp/credits.ts` with `balance`, `mediaCreditsShort`
  and the `get_credits` tool body from `lib/cmo/mcp/account.ts`. Drop the sentence "Planning and writing in Claude need
  no credits." and the "thinking in Claude does not" clause in the description. `get_mode` and `modeText` are not
  moved: they go with mode B.
- [x] A2. Register `get_credits` in an editor group: new `packages/mcp-server/src/groups/credits.ts`, imported in
  `groups/index.ts` where `account` was. It uses the registry's `McpTool` type directly (no `CmoMcpTool`).
- [x] A3. Point `lib/departments/studio/adapter.ts` at `@/lib/mcp/credits`.
- [x] A4. `cmo-live.check.ts`, `cmo-decisions.check.ts`, `cmo-editor.check.ts` import `CMO_TOOLS` only to check that
  some tools are hidden from MCP. Delete those assertions, keep the rest of each check. Read each one first: if a
  check exists only for MCP, say so in the PR and delete that block.
- [x] A5. Delete `packages/mcp-server/src/groups/{cmo,inbox,account}.ts` and their imports. Update the header comment
  of `groups/index.ts` and `registry.ts` (no "Session B" groups any more).
- [x] A6. Delete `apps/web/lib/cmo/mcp/` and the `lib/cmo/mcp/mcp.check.ts` entry in `check:contracts`. Check whether
  `inbox.e2e.ts` is listed in any script or Playwright config and remove that entry too.
- [x] A7. `server.check.ts`: remove the cases for the CMO, inbox and account tools, prompts and resources. Add one
  case: `tools/list` has `get_credits` and none of `create_task`, `list_inbox`, `get_mode`, `read_cmo_playbook`;
  `prompts/list` has no `onboard`, `plan-week`, `sales-scan` or `inbox`.
- [x] A8. `lib/cmo/capabilities.check.ts` line ~202: the comment says MCP shares this file. Fix it to "the CMO chat".

## Gate

`cd packages/mcp-server && npm run check && npm test`; `cd apps/web && npm run typecheck && npm run check:contracts`.
Then `grep -rn "lib/cmo/mcp" apps packages` returns nothing.

## What I ran, what I could not

Done 2026-11-14 on `e78722b`.

- `packages/mcp-server`: `npm run check` (tsc) passes; `npm test` passes: `server.check` 111 tools, 5 prompts,
  25 resources, and `oauth.check`. `npm run build` bundles (`dist/` not committed).
- `apps/web`: `tsc --noEmit` passes; `npm run check:contracts` passes in full (exit 0, the fake CMO eval included).
- `grep -rn "lib/cmo/mcp" apps packages` is empty. `inbox.e2e.ts` was not listed in any script or Playwright config.
- Not run: `npm run build` of the web app and the e2e suites (nothing in A touches pages); CI runs them.

Beyond the list, found while doing it:

- **The editor MCP read no-ai-slop through a CMO tool.** The server instructions told every client to call
  `read_cmo_playbook no-ai-slop` before writing words a person reads (CLAUDE.md's rule). Deleting the CMO group would
  have left that pointing at nothing. `read_guide` now takes `no-ai-slop` too (the same `skillText("no-ai-slop")` the
  in-app prompts embed), it is a resource `opencmo://guides/no-ai-slop`, and the instructions say `read_guide
  no-ai-slop`. `server.check` reads it through the tool.
- `packages/contracts/capabilities.json`: `plan_week`, `post_draft`, `sales_scan`, `competitor_research` and
  `write_video_brief` no longer list the `mcp` caller; `capabilities.check` lists `cmo-tools.ts` as `assistant` only
  and fails if any file of `packages/mcp-server/src` imports `@/lib/agent/cmo-*` or `@/lib/cmo/mcp` again (that
  replaces the three `CMO_TOOLS` assertions A4 deleted). Studio's `mcp` callers stay: the editor's studio group uses them.
- `SERVER_VERSION` 2.0.0 → 3.0.0: tools and prompts were removed, so a client that cached the old list sees a new major.
- `get_credits` lives in its own group file, `groups/credits.ts`, registered last.
