# MCP agent team: work split for two sessions, one PR

Plan: [`docs/mcp-on-modal-plan.md`](mcp-on-modal-plan.md) — read it first, all of it.
Branch: **`mcp-agent-team`** · PR: one draft PR into `main`, shared by both sessions.

Two Claude Code sessions build this in parallel on the same branch:

- **Session A — Platform & Studio**: the MCP server on Modal, the shared tool package, auth,
  async jobs, every editor / explainer / media tool, editor prompts and guides.
- **Session B — CMO, Inbox & Claude-side**: CMO tools, the Inbox and the mode switch, the cron
  change, "Continue in Claude" in the app, CMO prompts and skills, the `opencmo` Claude skill and
  the Claude Code plugin.

## Rules for both sessions

1. **Own your paths.** Edit only the paths listed for your session. Need a change in the other
   session's paths? Write it under "Requests" below and let them make it.
2. **Same branch, no force.** `git pull --rebase origin mcp-agent-team` before every push; never
   `--force`; never rebase pushed commits; never push to `main`.
3. **Small commits, prefixed** `[A]` or `[B]`, English messages, each one green on its own
   (typecheck + the tests of what it touches). End with the attribution lines from CLAUDE.md
   tooling.
4. **Update your checklist** in this file in the same commit that finishes an item (only your own
   section, to avoid conflicts).
5. **Repo rules still apply** (CLAUDE.md): assist, never act; editor-core is the only write path;
   every write through an ownership-checking RPC; credits only via `credit_hold/settle/refund`;
   every migration gets a pgTAP test and a `supabase/schema/current.sql` refresh; moderation stays
   server-side; English everywhere; peak RAM / 3-minute budgets untouched.
6. **Heavy suites one at a time** on this laptop (e2e, build, `db:reset`, Modal runs).
7. **Do not deploy.** No `supabase db push`, no `modal deploy` to production. Use `modal serve`
   / a dev Modal environment and local Supabase. Marcus deploys after review.

## Shared contracts (Session A lands these first, in commit A1)

B codes against these from the start; A must not change them without a "Requests" note.

```ts
// packages/mcp-server/src/registry.ts
export type McpToolContext = {
  supabase: SupabaseClient;         // RLS-bound client for the calling user
  userId: string;
  callModal: <T>(fn: string, payload: unknown) => Promise<T>;   // .remote() on our Modal app
  spawnModal: (fn: string, payload: unknown) => Promise<string>; // returns a call id
};
export type McpTool = {
  name: string; title: string; description: string;
  inputSchema: z.ZodType; outputSchema?: z.ZodType;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  costsCredits?: boolean;           // true → the server enforces the two-step price → confirm
  run: (input: unknown, ctx: McpToolContext) => Promise<McpResult>;
};
export type McpPrompt = { name: string; title: string; description: string; arguments?: { name: string; required?: boolean }[]; render: (args: Record<string, string>) => string };
export type McpResource = { uri: string; name: string; mimeType: "text/markdown"; read: (ctx: McpToolContext) => Promise<string> };
export function registerGroup(group: { tools?: McpTool[]; prompts?: McpPrompt[]; resources?: McpResource[] }): void;
```

- Groups live in `packages/mcp-server/src/groups/<name>.ts`; `src/groups/index.ts` imports
  them. A owns `index.ts`; B adds its imports there via a "Requests" note **or** A pre-creates the
  import lines for `cmo`, `inbox`, `account` pointing at empty B-owned files in A1.
- Errors the model should read: `McpResult` with `isError: true` and an English sentence.
- Slow work (> ~60 s; Modal cuts web requests at 150 s): return `{ id, status }` and expose a
  poll tool; never block a request on a render.

## Session A — Platform & Studio

**Owns:** `packages/agent-tools/**`, `packages/mcp-server/**` except `src/groups/{cmo,inbox,account}.ts`,
`apps/web/lib/agent/**`, `apps/web/lib/mcp/**`, `apps/web/app/api/mcp/**`,
`packages/engine/modal_app.py` (only the new `opencmo-mcp` function block),
`apps/web/lib/motion/**`, editor guides in `apps/web/lib/agent/guides.ts`.

- [ ] **A1 — Contracts + skeleton.** `packages/mcp-server` with the registry above, official
      `@modelcontextprotocol/sdk` Streamable HTTP (stateless, JSON responses), API-key auth
      reused from `lib/mcp/auth.ts`, `initialize` instructions, empty `cmo`/`inbox`/`account`
      group files for B. Local run with `tsx`; MCP Inspector lists zero tools cleanly.
- [ ] **A2 — Extract `packages/agent-tools`.** Move what MCP needs out of `apps/web/lib/agent`
      (tools, scope, explainer-tool, generate-tool, create-video, video-team, guides, skills) with
      the Supabase client injected; no `server-only`, no `@/` aliases. The Next.js Assistant
      imports the package; behavior unchanged. Verify: `check:contracts`, Assistant eval
      (`agent:eval` offline/fake), `tsc`.
- [ ] **A3 — Modal app.** `opencmo-mcp`: Node image built from the repo, `@modal.web_server`,
      `@modal.concurrent`, `min_containers=1`, secrets (`opencmo`, `opencmo-voice`, `fal-secret`).
      `callModal`/`spawnModal` call `render_motion` / `motion_preview` / `run_task` directly.
      `modal serve` URL works with the Inspector and Claude Code (`claude mcp add --transport http`).
- [ ] **A4 — Studio tools.** Find/read tools, all editor-core ops with `clip_id`, support tools
      (`find_filler_words`, `find_silences`, `find_retakes`, `find_icons`, `find_lotties`,
      `insert_asset`, `place_broll`, `check`…), annotations + output schemas, MCP checkpoint per
      write (as today).
- [ ] **A5 — Media + explainer tools.** `generate_media`, `create_video` (accepts Claude's
      script/shot list), `edit_video`, `replace_background`, `add_voiceover`, `plan_video`
      (accepts a full intro plan; the code Reviewer stays), `get_explainer_kit`,
      `preview_explainer` (stills as image content + layout report), `add_explainer`,
      `get_generation`, `wait_for_media` (≤ 50 s per call). Two-step price → confirm for every
      `costsCredits` tool. Scene code only ever runs in the render containers.
- [ ] **A6 — Export + account basics.** `export_clip` (async) → `get_export` (signed URL),
      `open_in_editor` (URL). (Credits read is B's `account` group.)
- [ ] **A7 — Editor prompts + resources.** Prompts `/explain`, `/video`, `/roughcut`, `/broll`,
      `/intro` (same directives as `lib/agent/slash.ts`); resources `opencmo://guides/{name}` (20)
      and `opencmo://kit/explainer`; user editor skills `opencmo://skills/mine/{name}` +
      `read_skill`/`save_skill`.
- [ ] **A8 — OAuth 2.1.** Protected-resource metadata, authorization server (verify Supabase
      OAuth server support first; write findings here), token → user → RLS JWT. API keys keep
      working for Claude Code. Verify: add the connector from claude.ai.
- [ ] **A9 — Preview cap.** `rate_limit_hit` bucket `mcp_preview` (per user per hour), tests.
- [ ] **A10 — End-to-end.** Claude Code over `modal serve`: vaccine explainer from storyboard to
      clip; `/video` 15 s; rough cut on an uploaded clip. Extract a frame from the full-size file
      and look at it (CLAUDE.md "Verify by looking").

## Session B — CMO, Inbox & Claude-side

**Owns:** `packages/mcp-server/src/groups/{cmo,inbox,account}.ts`, `apps/web/lib/cmo/**`,
`apps/web/lib/agent/cmo-tools.ts`, `apps/web/lib/agent/cmo-research.ts`, `apps/web/lib/llm-health.ts`,
`apps/web/app/api/cron/**`, the Assistant panel's "Continue in Claude" UI
(`apps/web/components/editor/assistant/**` — coordinate the one entry point with A), new
`supabase/migrations/*_cmo_inbox*.sql` + their pgTAP tests, `plugins/opencmo-claude/**`.

Until A1 lands, start with B1–B3 (no dependency on the registry).

- [x] **B1 — Inbox schema.** Migration: `cmo_inbox` (user, kind, input, context snapshot, status
      `open|claimed|submitted|expired`, created/claimed/submitted at), RLS owner-only, RPCs
      `inbox_list`, `inbox_claim`, `inbox_submit` (ownership-checked, idempotent by request id);
      pgTAP; `scripts/dump-schema.sh`.
- [x] **B2 — Mode switch.** One server function `brainMode(supabase, userId)` → `"opencmo" |
      "claude"`: balance below `AGENT_HOLD_CREDITS`, or `llm-health` `account` outage on both
      providers. Unit check file.
- [x] **B3 — Cron writes to the inbox in mode B.** `lib/cmo/loops.ts` / runner: same `LoopRun`,
      but a mode-B user gets an inbox item instead of an LLM call. Jobs: `plan_week`,
      `review_week`, `post_draft`, `sales_scan` (threads fetched server-side first),
      `video_pack`, `summarize_memory`, `competitor_research`. Existing job checks stay green.
      *Done as:* every job's model call goes through `ctx.think()` (`lib/cmo/jobs/think.ts`). An
      inbox run (`input.brain = "claude"`, 0 credits) reads server-side as usual and stops at its
      first model call: `cmo_inbox_open` stores the request (system, prompt, JSON schema) and ends
      the run in one transaction. `inbox_submit` stores Claude's answer under the step's label and
      queues a replay that feeds it back through the same zod schema and deterministic checks;
      a failed check reopens the item with the reason (`cmo_inbox_finish`). Jobs with several
      calls go round once per call (sales scan: queries → scores → replies); outside reads are
      memoized between rounds (`ctx.step(..., { memo })`). Checker calls are skipped in mode B.
      Step labels: `plan_week`, `review_week`, `summarize_memory`, `draft_post`, `make_queries`,
      `score_thread`, `draft_reply`, `write_captions`, `competitor_research`.
- [ ] **B4 — CMO group.** The 20 CMO tools (`read_doc`, `update_document`, `read_site`,
      `search_reddit`, `reddit_thread`, `subreddit_posts`, `find_outliers`, `x_profile`,
      `search_videos`, `search_threads`, `get_transcript`, `create_task`, `create_video_brief`,
      `get_run_result`, `list_calendar`, `list_approvals`, `set_week_goal`, `remember`,
      `research_credits`, `read_skill`), annotated; no tool posts anything. Per-user caps on
      social reads and `read_site` (`rate_limit_hit` buckets).
      *Status:* code done in `apps/web/lib/cmo/mcp/cmo.ts` (`CMO_GROUP`); `read_skill` is exposed
      as `read_cmo_playbook` (A7 owns `read_skill`); caps are `cmo_read_hit` (`mcp_social` 60/h,
      `mcp_site` 20/h), a separate function so A9 can replace `rate_limit_hit` freely; a "now"
      `create_task` over MCP goes to the inbox at 0 credits. Registration waits for A1.
- [ ] **B5 — Inbox group.** `list_inbox`, `get_inbox_item` (the context the job would have
      built: documents, skills, metrics, threads), `submit_plan`, `submit_post_draft`,
      `submit_sales_scan`, `submit_video_pack`, `submit_memory`, `get_check_rubric`. Submissions
      validated by each job's zod schema + deterministic checks, then the usual approval cards.
      *Status:* code done in `apps/web/lib/cmo/mcp/inbox.ts` (`INBOX_GROUP`), plus
      `submit_research`; step → schema → submit tool table in `lib/cmo/jobs/steps.ts`; X drafts are
      code-checked before they are stored. Registration waits for A1.
- [ ] **B6 — Account group.** `get_credits`, `get_mode` (A/B and why), top-up message for media
      tools when the balance is short (shared helper A's media tools call — publish its
      signature under "Requests").
      *Status:* code done in `apps/web/lib/cmo/mcp/account.ts` (`ACCOUNT_GROUP`,
      `mediaCreditsShort`). Registration waits for A1.
- [ ] **B7 — CMO prompts + resources.** Prompts `/onboard`, `/plan-week`, `/sales-scan`,
      `/inbox`; resources `opencmo://skills/cmo/{name}` (7) and `opencmo://skills/library/{name}`
      (38, with `LIBRARY_PREAMBLE`).
      *Status:* code done in `apps/web/lib/cmo/mcp/prompts.ts` (on `CMO_GROUP`). Registration waits
      for A1.
- [x] **B8 — "Continue in Claude".** In mode B the Assistant panel and CMO chat show a card:
      what happened, how to connect (connector URL, Claude Code command), and the inbox count.
      Copy follows CLAUDE.md product rules (describes software; no model names as features).
      *Done as:* `GET /api/v1/cmo/mode` (brain, reason, credits, open inbox count, MCP URL from
      `OPENCMO_MCP_URL`, default `${SITE_URL}/api/mcp`); `ContinueInClaude` card under the
      Assistant header (the one entry point in `AssistantPanel.tsx`) and the CMO chat header. In
      mode B "Plan my week" / "Run now" go to the inbox instead of failing for credits.
- [x] **B9 — Claude-side bundle.** `plugins/opencmo-claude/`: `skills/opencmo/SKILL.md`
      (workflows, price etiquette, "drafts only, you post", Inbox routine) + plugin manifest with
      the MCP server config. Zip for claude.ai skill upload. Verify by installing locally.
      *Done as:* `plugins/opencmo-claude` (plugin + one-plugin marketplace, `.mcp.json` reads
      `OPENCMO_API_KEY` and `OPENCMO_MCP_URL`, `scripts/zip-skill.sh` for claude.ai). `claude plugin
      validate` passes; `marketplace add` + `install` in a clean HOME shows 1 skill + 1 MCP server.
      The skill names A's tools (`preview_explainer`, `get_generation`, guides): A, correct it if
      your names change.
- [ ] **B10 — End-to-end.** Staging-like local run with Anthropic + Gemini keys removed: cron
      creates inbox items; Claude Code `/inbox` completes a weekly plan, an X draft and a Reddit
      scan; cards appear in Approvals; nothing posts.
      *Status:* the server half passes against local Supabase with no LLM keys —
      `lib/cmo/mcp/inbox.e2e.ts`: a founder at 0 credits; the cron sends the day's X draft and
      Reddit scan to the inbox; the inbox tools under the founder's RLS JWT (`clientFor`, as MCP)
      read, refuse a draft that fails the checks, submit (idempotent), and the replays create 1 X
      card and 5 Reddit cards at 0 credits; nothing posts. The "Continue in Claude" card was
      checked in the running app (screenshot: inbox count, connect steps).
      *Claude Code run (2026-10-16):* a real headless Claude Code session (`claude -p
      "/mcp__opencmo__inbox"`) against a test-only stdio server exposing B's three groups under the
      founder's RLS session, with a 5-second sweep loop in place of Modal and no LLM keys: it read
      the mode, wrote the X post (card in Approvals, 2 alternates), answered the Reddit scan's
      queries and scored all 30 threads with exact quotes (the fake threads scored under 60, so no
      cards, as they should); 5 runs, 0 credits. It found one bug, fixed: Claude Code shows the
      model `structuredContent` when present, so every structured result now repeats the full text
      as `message`. The harness was not committed (A1 brings the real server). Left for A1/A3:
      the same run over `modal serve`.

## Sync points

| When | Who | What |
|---|---|---|
| A1 pushed | A → B | B rebases and switches its groups onto the registry |
| B6 helper signature | B → A | A's media tools call it for the top-up message |
| A3 `modal serve` URL | A → B | B runs its tools against the real server |
| A8 + B9 | both | Connector from claude.ai + skill installed: full demo |
| Before marking ready | both | `npm run typecheck`, `npm run build`, `check:contracts`, engine pytest + ruff, `db:reset && db:test`, e2e (one at a time) |

## Requests (append-only; `[A→B]` or `[B→A]`, date, what, status)

- `[B→A]` 2026-10-16 — **Group files.** B's groups are ready as plain objects in
  `apps/web/lib/cmo/mcp/index.ts`: `CMO_GROUP`, `INBOX_GROUP`, `ACCOUNT_GROUP` (tools, prompts,
  resources in the contract's shapes; `run(input, ctx)` only reads `ctx.supabase` and
  `ctx.userId`; results are `{ content: [{ type: "text", text }], structuredContent?, isError? }`
  — tell me if `McpResult` differs). Once A1 lands, B's group files are one line each:
  `registerGroup(CMO_GROUP)`. Status: open.
- `[B→A]` 2026-10-16 — **A2 must carry B's imports.** `lib/cmo/mcp/*` imports `@/lib/agent/cmo-tools`,
  `@/lib/agent/cmo-research`, `@/lib/cmo/**`, `@/lib/site`, `@/lib/llm-health`; `cmo-tools.ts`
  imports `server-only` and `startCmoRun` (`next/server` `after()`; inbox runs skip the kick, but
  the import stays). Either `agent-tools` takes these as they are, or tell me where to move
  them. Status: open.
- `[B→A]` 2026-10-16 — **Top-up helper (B6).**
  `mediaCreditsShort(supabase: SupabaseClient, userId: string, needed: number): Promise<string | null>`
  from `apps/web/lib/cmo/mcp/account.ts`: null when the balance covers `needed`, else the
  sentence to return as the media tool's `isError` result. Status: published.
- `[B→A]` 2026-10-16 — **Tool name.** The CMO chat's `read_skill` is `read_cmo_playbook` over MCP;
  `read_skill` / `save_skill` stay yours (A7). Status: FYI.
- `[B→A]` 2026-10-16 — **`video-usecases.check.ts` red locally.** Not a bug: this container has
  `ELEVENLABS_API_KEY` set, so the ElevenLabs voice ("Aria") wins over the fake "Test A". The full
  `check:contracts` passes with that key unset, as in CI. Status: resolved, FYI.
- `[B→A]` 2026-10-16 — **structuredContent.** Claude Code shows the model `structuredContent` instead
  of `content` when a result has it (found in B10). B's results repeat the full text as
  `message`; A's tools with `outputSchema` need the same, or the model loses the text. Status: FYI.

## Out of scope for this PR

- Moving `select.py` (clip picking) off the server; only an optional manual `pick_moments` later.
- Storage move to Spaces (`docs/storage-spaces-migration.md`).
- MCP Apps UI (phase 4 of the plan) unless both lists above are done.
