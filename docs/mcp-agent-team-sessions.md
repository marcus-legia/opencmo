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

- [x] **A1 — Contracts + skeleton.** `packages/mcp-server`: the registry above (additive:
      `McpTool.price`, `inputJsonSchema`, `McpGroup.toolsFor`, `McpResourceTemplate`), the official
      SDK's Web-standard Streamable HTTP transport (stateless, JSON responses, one `Server` per
      request), API keys through `lib/mcp/auth.ts`, `initialize` instructions, the `cmo` / `inbox` /
      `account` group files (B's, empty until B registers its groups). The registry refuses a name
      registered twice. Local: `npm run dev --workspace @opencmo/mcp-server` (tsx, port 8787);
      checked with the SDK's own client (initialize, every list, calls). `npm run test:mcp-server`
      checks the contract without a database.
- [x] **A2 — One tool layer for the Assistant and MCP.** Done in place, not as a moved package:
      the Assistant's clip scope takes an injected host (`clipScopeWith(supabase, context, clip,
      host)` in `lib/agent/scope.ts`: checkpoint, model usage, previewed code, liveness, turn), so
      the MCP server runs every clip tool through the exact code the Assistant uses. Why not
      `packages/agent-tools`: the import closure of the tools is 95 files (lib/api, lib/editor,
      lib/generate, and Session B's `lib/cmo/**`); moving them would touch most of the app and B's
      paths for no change in behavior. The MCP server imports them through the `@/` path alias and
      the `react-server` condition (`server-only` is empty there), and its Modal build bundles them
      (A3). Fixed on the way: signed URLs for transcripts and exports took the cookie client, so
      they failed with no browser session; they now use the caller's client. `create_video` and
      `plan_video` accept a finished plan from the caller (reviewed the same way, no model call;
      `lib/agent/client-plans.check.ts`). Verified: `check:contracts`, `agent:eval` (fake, 41/41
      with the local motion CLI), `tsc`.
- [x] **A3 — Modal app.** `opencmo-mcp` in `modal_app.py`: a Node 22 image with one bundled file
      (`npm run build:mcp-server` → `packages/mcp-server/dist/server.cjs`, esbuild, `react-server`
      condition, `next/server`/`next/headers` stand-ins), `@modal.web_server(8000)`,
      `@modal.concurrent(max_inputs=50)`, `min_containers=1`, 0.25 core / 512 MB, secrets
      `opencmo`, `opencmo-voice`, `fal-secret` + `opencmo-mcp` (the web-side variables; listed in
      the block's comment). Without the bundle the app deploys without this function, so the
      worker's own deploy never depends on it. `callModal` / `spawnModal` use Modal's JS client
      (`modal` npm, `functions.fromName("opencmo", …)`, allowlist `render_motion`, `render_three`,
      `run_task`); today's tools go through the task queue and `motion_preview` exactly like the
      app, so none of them needs it yet. Checked: the bundle alone in a clean `node:22-slim`
      container (no repo, no node_modules) serves every flow against local Supabase; `modal_app.py`
      imports with modal 1.6.2 and registers `mcp_server`. Not checked here: `modal serve` itself
      (no Modal token in this session); first run: `npm run build:mcp-server`, create the
      `opencmo-mcp` secret, `modal serve packages/engine/modal_app.py`, then
      `claude mcp add --transport http opencmo https://<workspace>--opencmo-mcp-dev.modal.run/mcp
      --header "Authorization: Bearer ocm_…"`.
- [x] **A4 — Studio tools.** Every Assistant clip tool with `clip_id` (`groups/studio.ts`), run
      through the Assistant's own scope; each write is a checkpoint "MCP" in Version history. Left
      out: the six browser tools (capture, waveform, 3D preview, save frame, grab, color),
      `ask_user`, `update_plan`, `undo`. Clip-free: `find_icons`, `find_lotties`, `read_guide`,
      `read_skill`, `save_skill`. Find: `list_projects` (also lists New edits, which the app's
      project list leaves out), `list_clips`, `new_edit`, `open_in_editor`. Annotations on every
      tool; output schemas on the tools whose result has a fixed shape (find, kit, generation,
      export); clip tools return the Assistant's JSON. A clip never opened in the editor gets its
      project on the first call, as the editor does.
- [x] **A5 — Media + explainer tools.** `generate_media`, `add_3d_scene`, `add_voiceover`,
      `replace_background`, `edit_video`, `add_captions`, `translate_captions`, `create_video`
      (requires Claude's director plan; the reviewer's notes come back to fix), `plan_video`
      (requires Claude's IntroSpec; the code Reviewer stays), `add_explainer`, `export_clip`: price
      → confirm enforced by the server for all of them. A confirm code is signed (user, tool,
      clip, 10 minutes, deflated payload) and works once (`mcp_confirm_use`: a replay would place
      the same generation twice). When the balance is short the price step returns B6's top-up
      sentence. `preview_explainer` returns the stills as image content plus the layout report and
      a `preview_token`; `add_explainer` takes only code with a token for that exact code.
      `get_explainer_kit`, `get_generation`, `wait_for_media` (≤ 50 s). Scene code runs only in
      `motion_preview` / `render_motion`. Checked locally: vaccine explainer preview (6 stills,
      looked at), price 9 credits, confirm → generation queued; replay refused.
- [x] **A6 — Export + account basics.** `export_clip` (price card: frames, resolution, the plan's
      daily exports) → task ids → `get_export` (status, progress, signed download link),
      `open_in_editor`. Checked locally up to the queued render task.
- [x] **A7 — Editor prompts + resources.** Prompts `/explain`, `/video`, `/roughcut`, `/broll`,
      `/intro` (the slash directive + the MCP steps + the guide); resources
      `opencmo://guides/{name}` (22) and `opencmo://kit/explainer` (the code section of the
      explainer guide); template `opencmo://skills/mine/{name}` + `read_skill`/`save_skill`.
- [x] **A8 — OAuth 2.1.** Findings (Supabase CLI 2.117 / auth-js 2.117, checked locally): Supabase
      Auth has an OAuth 2.1 server — authorization code + PKCE (S256), dynamic client
      registration, refresh tokens; issuer `<supabase>/auth/v1`, metadata at
      `<supabase>/auth/v1/.well-known/oauth-authorization-server` and `…/openid-configuration`
      (the RFC 8414 path-inserted URL is 404; the MCP SDK's client tries the appended OIDC URL
      third and finds it). Access tokens are ordinary user JWTs (`role: authenticated`) plus
      `client_id`, so they work under RLS as they are. The app hosts the consent screen.
      Built: `/.well-known/oauth-protected-resource` + `WWW-Authenticate: Bearer
      resource_metadata=…` on the MCP server; tokens checked with Supabase Auth on every request
      and refused without `client_id` (a web session token is not an MCP credential);
      `/oauth/consent` (sign-in kept through `next`, client name, what it may do, Allow / Deny →
      `POST /api/v1/oauth/consent`, then a script navigation: the CSP's `form-action 'self'`
      blocks a form redirect to another site); Settings → Connected apps (list, Disconnect);
      the API-keys card shows `OPENCMO_MCP_URL`. API keys keep working. Verified locally: the
      SDK's OAuth client from 401 to tools (DCR, PKCE, consent, code, token, `new_edit`), the
      consent page in Chromium (signed out → login → Allow → callback with code and state),
      cross-site POST 403, revoke → 401 at once. Production: Authentication → OAuth Server: on,
      authorization path `/oauth/consent`, dynamic registration on (`supabase/config.toml` has
      the same for local). Not checked here: adding the connector from claude.ai itself (needs
      the deployed server).
- [x] **A9 — Preview cap.** `rate_limit_hit` bucket `mcp_preview`, 30 per user per hour, in
      `20261129090000_mcp_server.sql` with `mcp_confirm_use`; pgTAP `160_mcp_server.test.sql`;
      schema dump refreshed. `rate_limit_hit` is copied from its latest definition (G5) plus the
      new bucket: a later migration that replaces it must start from this one.
- [x] **A10 — End-to-end.** Run with Claude Code (2.1, headless, its own config) connected by
      `claude mcp add --transport http … --header "Authorization: Bearer ocm_…"` to the server on
      `127.0.0.1:8787` (tsx; the same code the Modal bundle serves), local Supabase and the local
      worker (fake media models, local clip-motion, silent voice; uploads through
      `tests/e2e_worker.py`, which only replaces transcription and moment picking):
      - Explainer: "how a vaccine trains the immune system", 30 s 16:9 — guide → kit →
        `find_icons` ×8 → `preview_explainer` ×3 (fixed empty frames, an off-safe-area group, a
        still beat; third preview clean) → price 8 credits → confirm → `wait_for_media` → done.
        Full-size file 1920×1080, 30 s with audio; frames at 3/8/15/20/27 s show each beat's
        subject. Layer "Explainer: …" on the edit, checkpoint "MCP".
      - `/video` 15 s: Claude wrote the director plan → `create_video` priced 31 credits →
        confirm → 3 shots + voice + music done → `export_clip` → `get_export` → 1280×720 MP4,
        15 s; frames show each shot at its time and the on-screen text.
      - Rough cut of an uploaded talk (API upload → clip): guide → state → transcript → fillers,
        silences, retakes → `remove_words` + `remove_silence` → `check` clean; 8.0 s → 2.95 s;
        the export's captions read "we built this in a weekend" (the cut word gone).
      Found and fixed on the way: a generation's note called a `/video`'s pieces "variants"
      (Claude told the user to pick a variant that does not exist). Not run here: `modal serve`
      (no Modal token), claude.ai's connector UI (needs the deployed server), real fal /
      ElevenLabs output (no keys reachable), the Playwright e2e suite (needs Google Chrome for
      H.264; its download host is blocked in this session).

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
- [x] **B4 — CMO group.** The 20 CMO tools (`read_doc`, `update_document`, `read_site`,
      `search_reddit`, `reddit_thread`, `subreddit_posts`, `find_outliers`, `x_profile`,
      `search_videos`, `search_threads`, `get_transcript`, `create_task`, `create_video_brief`,
      `get_run_result`, `list_calendar`, `list_approvals`, `set_week_goal`, `remember`,
      `research_credits`, `read_skill`), annotated; no tool posts anything. Per-user caps on
      social reads and `read_site` (`rate_limit_hit` buckets).
      *Status:* code done in `apps/web/lib/cmo/mcp/cmo.ts` (`CMO_GROUP`); `read_skill` is exposed
      as `read_cmo_playbook` (A7 owns `read_skill`); caps are `cmo_read_hit` (`mcp_social` 60/h,
      `mcp_site` 20/h), a separate function so A9 can replace `rate_limit_hit` freely;
      `get_transcript` is `get_video_transcript` (A's editor owns the name); a "now"
      `create_task` over MCP goes to the inbox at 0 credits. Registered in `packages/mcp-server/src/groups/` (2026-10-16).
- [x] **B5 — Inbox group.** `list_inbox`, `get_inbox_item` (the context the job would have
      built: documents, skills, metrics, threads), `submit_plan`, `submit_post_draft`,
      `submit_sales_scan`, `submit_video_pack`, `submit_memory`, `get_check_rubric`. Submissions
      validated by each job's zod schema + deterministic checks, then the usual approval cards.
      *Status:* code done in `apps/web/lib/cmo/mcp/inbox.ts` (`INBOX_GROUP`), plus
      `submit_research`; step → schema → submit tool table in `lib/cmo/jobs/steps.ts`; X drafts are
      code-checked before they are stored. Registered in `packages/mcp-server/src/groups/` (2026-10-16).
- [x] **B6 — Account group.** `get_credits`, `get_mode` (A/B and why), top-up message for media
      tools when the balance is short (shared helper A's media tools call — publish its
      signature under "Requests").
      *Status:* code done in `apps/web/lib/cmo/mcp/account.ts` (`ACCOUNT_GROUP`,
      `mediaCreditsShort`). Registered in `packages/mcp-server/src/groups/` (2026-10-16).
- [x] **B7 — CMO prompts + resources.** Prompts `/onboard`, `/plan-week`, `/sales-scan`,
      `/inbox`; resources `opencmo://skills/cmo/{name}` (7) and `opencmo://skills/library/{name}`
      (38, with `LIBRARY_PREAMBLE`).
      *Status:* code done in `apps/web/lib/cmo/mcp/prompts.ts` (on `CMO_GROUP`). Registered in
      `packages/mcp-server/src/groups/cmo.ts` (2026-10-16).
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
- [x] **B10 — End-to-end.** Staging-like local run with Anthropic + Gemini keys removed: cron
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
      as `message`. The harness was not committed.
      *Real server (2026-10-16, after A1):* the same run on A's `packages/mcp-server` (`npm run
      dev`, local Supabase, no LLM keys, founder at 0 credits) through the B9 plugin
      (`claude -p "Please work my OpenCMO inbox." --plugin-dir plugins/opencmo-claude`,
      `OPENCMO_MCP_URL` → the local server, a real `ocm_` key from `create_api_key`): the skill
      triggered, both items done (X card in Approvals; Reddit scan answered in two rounds, no
      thread passed 60 on the fake reader), 5 runs, 0 credits, key `last_used_at` set, no server
      errors. Not run over `modal serve`: no Modal credentials here, and Marcus chose local.

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

- `[A→B]` 2026-10-16 — **A1 landed; your groups fit.** `McpResult` is the SDK's
  `CallToolResult`; yours is a subset. `registerGroup(CMO_GROUP)` / `INBOX_GROUP` /
  `ACCOUNT_GROUP` type-check as they are (tried in a scratch file). The server also accepts
  image content, `outputSchema` and `annotations`. Status: answered.
- `[A→B]` 2026-10-16 — **Name clash: `get_transcript`.** The CMO group's `get_transcript` (a
  video's transcript) and the editor's `get_transcript` (the clip's words, named in every editor
  guide) cannot both exist; the registry throws at the first `tools/list`. Please rename yours
  (e.g. `get_video_transcript`) before registering `CMO_GROUP`. That was the only clash (tools,
  prompts, resources compared). Status: done — B exposes it as `get_video_transcript`.
- `[A→B]` 2026-10-16 — **B's imports under A2.** Carried as they are: the server imports
  `@/lib/**` through the path alias with the `react-server` condition (`server-only` is empty
  there); the Modal bundle (A3) does the same and maps `next/server` / `next/headers` to small
  stand-ins (`after()` runs the task without waiting; `cookies()` throws). Nothing to move.
  Status: answered.
- `[A→B]` 2026-10-16 — **Top-up helper used.** Every priced studio tool calls
  `mediaCreditsShort` in its price step and returns your sentence when the balance is short.
  Status: done.
- `[A→B]` 2026-10-16 — **`video-usecases.check.ts` fixed.** It picked the real voice when
  `ELEVENLABS_API_KEY` was set in the shell; it now clears the provider keys like the fake
  catalog it claims to use. Status: done.
- `[A→B]` 2026-10-16 — **Migrations.** Mine is `20261129090000_mcp_server.sql` (after both of
  yours) and redefines `rate_limit_hit` from G5 + `mcp_preview`; yours does not touch it. pgTAP
  file `160_mcp_server.test.sql`. Status: FYI.

- `[B→A]` 2026-10-16 — **Lockfile.** `packages/mcp-server/package.json` lists `@supabase/supabase-js`
  but the committed `package-lock.json` did not, so `npm ci` would refuse it; `npm install`
  added the one line and B committed it. Status: done, FYI.

- `[A→B]` 2026-10-16 — **e2e `cmo.spec.ts` red on this branch (green on `main`).** "Plan the
  week" never fills the calendar: e2e runs the fake model (`OPENCMO_AGENT_FAKE=1`) with
  `ANTHROPIC_API_KEY=""`, so `providersUp()` in `lib/cmo/brain.ts` counts 0 providers and
  `decideBrain` returns `claude` / `llm_down` for every e2e user — the job goes to the inbox.
  Suggested: count the fake provider as up when `fakeAllowed()` (never in production). Yours
  (`lib/cmo/**`). Status: open.
- `[A→B]` 2026-10-16 — **e2e run (Chrome for Testing 141, full suite).** 29/33 pass. Besides
  `cmo.spec.ts` above: `editor-captions.spec.ts` and `editor-rows.spec.ts` fail the same way on
  `main` (pre-existing, not this PR); `editor-generate.spec.ts` was Session A's (undo had no
  turn id) and is fixed. Status: FYI.

## Out of scope for this PR

- Moving `select.py` (clip picking) off the server; only an optional manual `pick_moments` later.
- Storage move to Spaces (`docs/storage-spaces-migration.md`).
- MCP Apps UI (phase 4 of the plan) unless both lists above are done.
