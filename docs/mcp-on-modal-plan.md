# Plan: rebuild the OpenCMO MCP server on Modal ("bring your own Claude")

Status: **proposed** (2026-10-16). Research: Modal docs (see Sources). Claude-side facts marked
*(verify)* come from memory, not from a source checked today.

## Goal

Let a user drive OpenCMO from their own Claude (claude.ai, Claude Desktop, Claude Code) through
MCP. Their Claude — Opus 5.5 on their plan — does the thinking (storyboard, explainer scene code,
edit plans); OpenCMO does only what needs our infrastructure: render, voice, storage, credits.

Why:

1. **Quality** — storyboards and scene code from Opus 5.5 instead of the in-app Sonnet 5.5.
2. **Cost** — the LLM bill moves to the user's Claude plan. Today every Assistant turn holds
   agent credits (`AGENT_HOLD_CREDITS = 5`, extend `10`, auto cap `60`) to cover our
   Anthropic/Gemini spend. Through MCP an explainer costs only its render + voice
   (`motion-explainer`: 1 credit per started 10 s + 5 per started 1,000 narration chars).
3. **Resilience** — when our Anthropic/Gemini keys are out of balance or down
   (`llm-health`), the app offers "Continue in Claude" instead of a dead Assistant.

## Scope: the whole agent team (added 2026-10-16)

Every LLM task in OpenCMO, with how it reaches the user's Claude. fal (images, video) and
ElevenLabs (voice, SFX, music) stay the media providers; only the thinking moves.

| Task | Agent (`lib/cmo/agents/registry.ts`) | Over MCP |
|---|---|---|
| Editor chat: 58 editor-core ops + 21 read/check tools | assistant | **Direct** |
| Explainer storyboard + scene code | assistant | **Direct** |
| AI video script + shot list | director | **Direct** (`create_video` takes Claude's script) |
| Intro words + motion plan | writer, motion | **Direct** (`plan_video` takes a full plan; the code Reviewer stays) |
| Caption translation | captions | **Direct** |
| CMO chat (20 tools), onboarding, competitor research | cmo, onboarding, research | **Direct** |
| Weekly plan / review, daily X draft, Reddit scan, video pack captions, memory summary | planner, x_writer, sales, video, checker | **Inbox** |
| Picking 5 moments in the clip pipeline | `engine/steps/select.py` | **Server** (must finish unattended in < 3 min); optional manual `pick_moments` |
| Prompt moderation, output image/frame moderation | `lib/generate/moderation.ts`, `opencmo/ai/moderation.py` | **Server, always** |

**Inbox.** MCP only runs while Claude is being used, so scheduled loops (`lib/cmo/loops.ts`)
cannot call it. In mode B the cron writes the job to an inbox instead of calling an LLM; the user
says `/inbox` in Claude, Claude does the work with the same context the job would build and
returns it through a `submit_*` tool; the server validates it with the job's existing zod schema
and deterministic checks, then creates the usual approval cards.

**Checker.** Today a separate Haiku context reviews drafts. Over MCP, Claude reviews its own
draft against `get_check_rubric`; the server's deterministic rules stay the last gate.

**Mode switch.**

- Mode A (default): OpenCMO's Anthropic/Gemini keys; agent credits (hold 5, extend 10, cap 60) +
  media credits.
- Mode B ("Continue in Claude"): the user's Claude thinks; 0 credits for thinking, credits only
  for fal / ElevenLabs / render. Entered when the user's balance is below one Assistant hold, or
  `llm-health` reports an `account` outage on both providers. The Assistant panel shows "Continue
  in Claude"; the CMO cron writes to the inbox. Media tools without credits answer "Top up
  credits to create media" instead of failing.

**Free-resource caps.** Previews, Reddit/X/ScrapeCreators reads and `read_site` cost OpenCMO money
with no agent credits behind them in mode B: per-user hourly caps in SQL (`rate_limit_hit`).

Work split for two sessions on one PR: `docs/mcp-agent-team-sessions.md`. Visual overview:
https://claude.ai/artifact/RWFMifHdNKfenZDtxDdiVa (private).

## What exists today (`apps/web/lib/mcp`, `app/api/mcp/route.ts`)

- Hand-rolled JSON-RPC, protocol `2025-06-18`, stateless, on Vercel (`maxDuration 300`).
- Auth: personal API key `Bearer ocm_…` → `api_key_owner` → 5-minute user JWT → everything
  under RLS. Rate limit 600 messages/hour.
- Tools: `list_projects`, `list_clips`, the Assistant's clip tools (`TOOL_SPECS` minus
  browser/input/plan tools) with `clip_id`, and `generate_media` with a signed two-step
  `confirm` (price first, HMAC-signed, 10 minutes).
- **Missing**: the explainer tools (`preview_explainer`, `add_explainer` live in `scope.ts`,
  not `TOOL_SPECS`), `create_video`, `edit_video`, voiceover, captions, export, skills,
  brand; no prompts, no resources, no structured output, no tool annotations; no OAuth, so
  claude.ai's connector UI cannot add it *(verify: claude.ai custom connectors need OAuth or
  no auth; a static Bearer header works in Claude Code/Desktop config only)*.

## What Modal gives us (from the docs)

| Need | Modal | Consequence for the design |
|---|---|---|
| HTTP server | `@modal.asgi_app()` (Python) or `@modal.web_server` (any process, e.g. Node) | We can run the **TypeScript** server, not a Python rewrite. |
| Stateless MCP | Modal's own example: FastMCP `streamable-http`, `stateless_http=True` | Matches our design; the newer spec revision (2026-07-28) makes the protocol core stateless. |
| Request time | **150 s HTTP timeout** on every web function; after that a 303 to a result URL (breaks POST JSON-RPC, breaks CORS) | Anything slower than ~1 minute must be **async**: start → id → poll tool. |
| Concurrency | `@modal.concurrent(max_inputs=…)` per container; queue when at the container cap | One small container serves many sessions. |
| Cold start | `scaledown_window` default 60 s (max 1,200 s), `min_containers`, `buffer_containers`, memory snapshots | `min_containers=1` for a snappy connector (~$10/month at 0.25 core + 0.5 GiB). |
| Rate limit | 200 requests/s per workspace (burst ×5), 429 above | Fine; keep our per-user limit in SQL. |
| Bodies | request up to 4 GiB, response unlimited | Preview stills can come back inline as images. |
| Untrusted code | Sandboxes (gVisor; VM runtime), default lifetime 5 min, up to 24 h | Scene code written by an **outside** model is even less trusted than our Assistant's; it keeps running only in the no-secrets render container (`render_motion` / `motion_preview`), or a Sandbox. |
| Auth | proxy tokens (`Modal-Key`/`Modal-Secret`) or our own Bearer check with a Modal Secret | Modal is not an OAuth server: we must provide OAuth ourselves (below). |

## Design

```
Claude (claude.ai / Desktop / Code)
   │  MCP Streamable HTTP, OAuth 2.1 bearer
   ▼
Modal: opencmo-mcp (Node, @modal.web_server, @modal.concurrent, min_containers=1)
   │  user JWT under RLS (same as today)          │ .spawn()/.remote() (no HTTP hop)
   ▼                                              ▼
Supabase (RPCs, credits, documents)        Modal: motion_preview / render_motion / run_task
```

1. **One codebase for tools.** The MCP server stays TypeScript and calls the same modules as the
   Assistant (`runTool`, `explainer-tool`, `generate-tool`, editor-core ops). Extract them from
   `apps/web/lib/agent` into a package `packages/agent-tools` (no `server-only`, no `@/` alias,
   Supabase client injected) so both Next.js and the Modal container import it. A Python
   FastMCP rewrite is rejected: it would be a second write path next to editor-core.
2. **Official SDK** (`@modelcontextprotocol/sdk`, Streamable HTTP, stateless) instead of the
   hand-rolled JSON-RPC: protocol version negotiation, `structuredContent`, annotations, prompts,
   resources come for free.
3. **Auth: OAuth 2.1 for claude.ai, API keys kept for Claude Code.** Supabase Auth as the
   authorization server *(verify: Supabase OAuth 2.1 server feature, DCR / Client ID Metadata
   Documents support)*; protected-resource metadata at `/.well-known/oauth-protected-resource`
   on the MCP host. Access token → user id → same short-lived RLS JWT as today.
4. **Async for anything slow.** `add_explainer`, `create_video`, `generate_media`, export: return
   `{generation_id, status}` at once; `get_generation` / `wait_for_media` (≤ 50 s per call)
   poll. Later, MCP Tasks *(verify: experimental in spec 2025-11-25; client support)*.
5. **Approval stays server-side.** Keep the signed two-step `confirm` for every tool that spends
   credits; the price is in the first result. Claude's own tool-approval prompt is not enough.
6. **Abuse budget.** Previews are free in-app because the Assistant turn holds credits. Through
   MCP they would be free compute: cap previews per user per hour in SQL (`rate_limit_hit`
   bucket `mcp_preview`), or charge 1 credit after N free.

## Tools, prompts, resources

Tools (annotated `readOnlyHint` / `destructiveHint` / `idempotentHint`, each with an
`outputSchema`):

| Group | Tools |
|---|---|
| Find | `list_projects`, `list_clips`, `get_project_state`, `list_library` |
| Explainer | `get_explainer_kit` (voices, themes, personalities, icons, Lottie list, limits), `preview_explainer` (stills as image content + layout report), `add_explainer` (price → confirm → async), `get_generation` |
| Create / edit | `create_video`, `edit_video`, `generate_media`, `add_voiceover`, captions, layout and the other clip ops |
| Ship | `export_clip` (async) → signed download URL |
| Memory | `read_skill`, `save_skill` (the user's editing recipes, `editor_skills`) |

Prompts (show up as commands in Claude *(verify for claude.ai)*): `/explain`, `/video`,
`/roughcut`, `/broll` — each is the matching guide plus the workflow steps the in-app slash
command adds today (`lib/agent/slash.ts`).

Resources: `opencmo://guides/{name}` (the 21 guides in `guides.ts`, including `explainer` and
`motion`), `opencmo://kit/explainer` (the scene-code API). Also exposed through `read_guide`, so
a client that never lists resources still gets them.

Server `instructions`: the short version of the workflow ("find the clip → read the guide →
storyboard and ask → preview until clean → price → confirm → poll").

**Skill on the Claude side.** MCP cannot install a Claude skill. Ship an `opencmo` skill
(SKILL.md: explainer storyboard rules, the preview loop, price etiquette) and a Claude Code
plugin that bundles the skill + the MCP config. The MCP prompts carry the same text for users
without the skill.

**Later: MCP Apps** *(verify support in Claude)* — the storyboard card, the price approval and a
video player rendered inline in the chat instead of text.

## Explainer workflow over MCP

1. User in Claude: "/explain how a vaccine works, 30 s, 16:9".
2. Claude reads `opencmo://guides/explainer` + `get_explainer_kit`, writes the storyboard
   (say / label / visual per beat) and shows it — no credits.
3. User approves → Claude writes scene code → `preview_explainer` → reads stills + report →
   fixes → up to 3 rounds (free, capped).
4. `add_explainer` → price + `confirm` → user agrees → `add_explainer(confirm)` →
   `generation_id`.
5. `get_generation` until done → the explainer lands on the clip (or a new edit) with captions →
   link to open it in the editor.

## Phases

| Phase | Scope | Done when |
|---|---|---|
| 0 | Extract `packages/agent-tools`; Next.js Assistant uses it unchanged | Assistant evals and `check:contracts` pass |
| 1 | Modal app `opencmo-mcp`: Node image, `@modal.web_server`, official SDK, API-key auth, existing tools + explainer tools, async generation | Claude Code makes a vaccine explainer end to end; MCP Inspector clean |
| 2 | OAuth 2.1 + protected-resource metadata; claude.ai custom connector | Added from claude.ai's connector UI, explainer end to end |
| 3 | Prompts, resources, annotations, `outputSchema`, preview cap, "Continue in Claude" when `llm-health` reports our keys down | Fallback demo with the Anthropic key removed |
| 4 | Claude skill + Claude Code plugin; MCP Apps for storyboard/price/player | Skill installed from the plugin; inline approval card |

Retire the Vercel `/api/mcp` route after phase 2 (keep it as a redirect for one release).

## Risks and open questions

- **Second deployment surface.** CLAUDE.md says one system, no second runtime: this stays the
  same TypeScript tools on Modal, which already runs the worker, but it is one more app to
  deploy and watch. Alternative if this gets heavy: keep MCP on Vercel and call Modal only for
  previews and renders.
- **150 s HTTP cap**: every slow tool must be async; `preview_explainer` must stay under ~60 s
  (`PREVIEW_TIMEOUT_MS`).
- **Model-written code from outside clients**: keep the render container without secrets or
  network; never run it in the MCP container.
- **Pricing**: should MCP explainers cost less than in-app ones (no LLM)? Proposal: same render +
  voice price, no agent credits.
- **Claude-side facts marked *(verify)***: confirm before phase 2/4.

## Sources

- Modal — stateless MCP server with FastMCP: https://modal.com/docs/examples/mcp_server_stateless
- Modal — web endpoints: https://modal.com/docs/guide/webhooks
- Modal — request timeouts: https://modal.com/docs/guide/webhook-timeouts
- Modal — cold starts: https://modal.com/docs/guide/cold-start
- Modal — Sandboxes: https://modal.com/docs/guide/sandbox
- Modal — pricing: https://modal.com/pricing
- Modal — hosting MCP for Claude (vendor blog): https://modal.com/resources/best-platforms-host-mcp-servers-for-claude
- Modal — multi-tenant MCP (vendor blog): https://modal.com/resources/best-hosting-multi-tenant-mcp-servers
