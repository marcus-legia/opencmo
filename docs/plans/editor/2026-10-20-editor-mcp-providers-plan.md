# Plan: editor over MCP, swappable model providers, editor research (2026-10-20)

> Status: **plan, not started.** Written from a conversation with the owner on 2026-10-20 and a read of `main` at
> `32c6ce7`, PR #84 at `07017e1`, `marcus-legia/OpenCut` at `e668010` and `opencut-app/opencut-classic` (shallow
> clone, read only). Each item still gets its own check of the code before it is built.

## Owner decisions (2026-10-20)

1. **PR #84 is paused.** It was opened to build clipping, and clipping (cutting clips out of a video taken from a
   link) is what the payment providers forbid ("content downloaders"). The PR stays open as a draft; nothing more is
   built on it.
2. **The editor-over-MCP work leaves PR #84** for a new PR from `main` (item 1).
3. **Clipping stays in the code for now** and will be re-engineered as **"edit the video, then the clips are made
   from the edit"** (item 6). Later the standalone clipping tool is removed from the product.
4. **The goal is an editor as good as CapCut, with the AI agent built in.** Editing by hand must work fully with no
   AI key on the server; the agent is a layer on top, not a requirement.
5. **Every server-side "checker" moves to Groq**: moderation (prompt text and image/video frames) and the CMO
   `check`-tier agents. Creem's own moderation replaces ours for payments later, so moderation must be a backend
   that can be swapped, not code welded to one vendor.
6. **Switching model provider must be configuration, not a code change** (item 2).
7. The owner will add `GROQ_API_KEY` later, and will scan CapCut with the `rea` MCP at home (item 5).

## Facts checked (2026-10-20)

- **Two different things run on Haiku today.**
  - **Moderation**: `apps/web/lib/generate/moderation.ts` (Haiku first, Gemini standby) and
    `packages/engine/opencmo/ai/moderation.py` (fal NSFW classifier, then Haiku/Gemini against the policy).
    Moderation is fail-closed, so with no Anthropic credit every MCP tool that moderates fails:
    `add_voiceover`, `add_explainer` (`lib/agent/scope.ts:329`), `generate_media` / `create_video`
    (`lib/generate/create.ts:128`, `lib/agent/screen-pieces.ts`). `moderationReady()` also requires `FAL_KEY`
    (`moderation.ts:40`), and fal has about 1–2 $ left.
  - **The CMO `check` tier**: `apps/web/lib/cmo/agents/registry.ts:51` defaults `checker`, `captions` and `writer`
    to Haiku (Gemini Flash on the Gemini provider).
- **Production is in "OpenCMO thinks" mode.** `get_mode` over MCP on 2026-10-20 answered `brain: "opencmo"`, so
  scheduled CMO work calls Anthropic and fails, then refunds. It keeps doing so until item 2 lands on Groq or
  `OPENCMO_BRAIN=claude` is set on Vercel.
- **The MCP server answers.** `list_projects` returned 2 projects (both `failed`, link clipping) and 16 New edits.
- **Provider choice is hard-coded as a pair.** `ProviderKind = "anthropic" | "gemini"` (`registry.ts:20`); the
  fallback is always "the other one" (`cmo/jobs/llm.ts:128`, `agent/model.ts:71`); each call site has its own
  per-vendor branch (`structuredAnthropic` / `structuredGemini`, `agent/providers/anthropic.ts` / `gemini.ts`,
  `_check_claude` / `_check_gemini` in Python). That is why adding a third vendor today means touching five places.
- **Manual editing needs no LLM.** `editor-core` ops (cut, text, captions, frame, keyframes, layout) make no model
  call. Transcripts come from ElevenLabs Scribe, and that key still works.
- **`marcus-legia/OpenCut` is the Rust rewrite** (83 commits; `apps/web/src/routes/editor.tsx` renders "Coming
  soon"). The web editor that works today is `opencut-app/opencut-classic` (MIT). The rewrite's roadmap — Editor API,
  plugins, MCP server, headless rendering, scripting tab — is the same direction as ours: track it as a competitor.

## Work items

### 1. Editor-over-MCP PR, split out of #84

New branch from `main`. Carry over from PR #84 only what is editor, not clipping:

- B7/B8 "look and listen": `capture_frame`, `inspect_color`, `media_grab`, `media_waveform`
  (`apps/web/lib/mcp/look.ts`, `packages/mcp-server/src/groups/look.ts`, `packages/clip-export/src/look.ts` + test,
  `packages/engine/opencmo/worker/look.py` + test, the `modal_app.look` endpoint).
- B9 `list_versions` / `restore_version` / `save_frame` (`lib/mcp/versions.ts`, `lib/mcp/save-frame.ts` + checks,
  `groups/versions.ts`).
- The open requests that belong to them: `OPENCMO_LOOK_TOKEN` / `OPENCMO_LOOK_URL` in `deploy_env.py`, and
  `capture` → `capture_frame` in guides read over MCP.

Left on #84: the moment picker, `make_clips`, the `manual_clip_moments` migration, raw clips without captions, the
proxy work. **Check:** `packages/mcp-server` check + build, `apps/web` typecheck + `check:contracts`, the look tests,
engine pytest.

### 2. One provider layer, swapped by env

**Status (2026-10-20):** first part in its own PR — registry kind `openai`, `CMO_LLM_PROVIDERS`, `structured()`
on any OpenAI-compatible endpoint, moderation (web and worker) as the `moderation` agent with fal optional, the
deploy check. Still to do: an OpenAI-compatible **chat** provider (the in-app CMO chat and the editor Assistant
keep Claude/Gemini until then), a live run on Groq once `GROQ_API_KEY` is in, and the `creem` moderation backend.

Goal: any agent or checker moves to another vendor by changing env on Vercel/Modal, with no code change.

- **A third provider kind, `openai`: any OpenAI-compatible endpoint** (base URL + key + model). Groq is the first
  user (`https://api.groq.com/openai/v1`); the same code covers OpenRouter, Together, DeepSeek, OpenAI and a local
  Ollama. Env follows the registry's existing scheme, plus a base URL:
  `CMO_AGENT_<ID>_PROVIDER=openai`, `CMO_AGENT_<ID>_BASE_URL`, `CMO_AGENT_<ID>_MODEL`, `CMO_AGENT_<ID>_API_KEY`,
  with shared defaults `OPENAI_COMPAT_BASE_URL` / `GROQ_API_KEY`.
- **One adapter per vendor, behind one interface**, used by every call site:
  `structured(schema)` (JSON schema output, zod-parsed, one repair retry when the answer does not parse) and
  `chat(tools)` for the editor Assistant. The call sites stop branching on vendor.
- **Fallback is an ordered list from env** (`CMO_LLM_FALLBACK=openai,gemini,anthropic`), skipping vendors with no
  key, instead of "the other one of two".
- **Moderation becomes registry agents**: `moderation` (text) and `moderation_vision` (images and frames), so
  `CMO_AGENT_MODERATION_PROVIDER=openai` etc. applies the same way. The rule "a verdict is final; only an outage falls
  through" stays.
- **Moderation is a backend interface**, not a vendor call: `llm-policy` (the policy prompt on any provider above),
  `nsfw-classifier` (fal, optional), and later `creem`. `moderationReady()` / `ready()` mean "a policy checker for
  text, and one for images, is configured", not "Anthropic and fal keys exist".
- **Python mirrors it minimally**: an OpenAI-compatible client in `opencmo/ai/` that reads the same env names, used by
  `moderation.py`; `select.py` keeps its own path until clipping is redesigned.
- **Pick Groq models from the live list** (`GET /openai/v1/models`) and its structured-output docs when the key is
  in, not from memory. Text policy: a model that supports JSON schema output. Images: a Groq vision model (a Llama
  Guard–type model if offered); if it covers sexual content reliably, fal's classifier becomes optional.
- **Check:** fake OpenAI-compatible server in `moderation.check.ts`, `llm` checks and the engine moderation pytest —
  clean prompt passes, policy prompt blocked with its category, 401/429/5xx falls through the list or refuses,
  malformed answer refuses. `agent:eval -- --provider fake` stays green. One real run per checker once the key is in.

### 3. Editor-over-MCP review, and editing with no AI key

1. **Inventory** the ~133 MCP tools in three groups: pure `editor-core` (no AI), needs moderation, needs a paid API
   (ElevenLabs, fal, Modal). Each tool that needs something says so in its error, in English, instead of failing
   silently.
2. **Smoke test against production** over MCP on a test New edit: `new_edit` → `add_text` → `remove_words` →
   `set_caption_style` → `check` → `export_clip` → `get_export`. Priced steps are shown to the owner before confirm.
3. **Local run with every AI key unset** (`ANTHROPIC_*`, `GEMINI_*`, `FAL_KEY`, `GROQ_API_KEY`): open the editor,
   edit by hand, export. Record what breaks, what hides itself, and what errors clearly.
4. Output: a pass/fail checklist in this folder, and fixes for the failures as their own PR.

### 4. Learn from OpenCut classic → research report

Report in `docs/research/editor/` (Vietnamese, per `docs/research/README.md`), with file:line citations. MIT, so code
may be copied with notice in `THIRD_PARTY_NOTICES.md`. First read (2026-10-20), to be confirmed in the report:

| OpenCut classic has | We have | First take |
|---|---|---|
| Whisper in the browser (`@huggingface/transformers`, WebGPU; tiny → large-v3-turbo; `apps/web/src/transcription/`) | ElevenLabs Scribe (paid, server) | **Strongest lesson**: captions with no key at all, which is exactly decision 4. Measure word-timing quality and model download size against Scribe |
| Client-side export with `mediabunny` (WebCodecs; `services/renderer/scene-exporter.ts`) | Export only on the Modal worker (watermark, one renderer) | Saves Modal, but conflicts with "export only on the worker"; at most a draft export |
| `CommandManager` with undo/redo, ripple mode and selection snapshots (`core/managers/commands.ts`, `ripple/`) | `applyOps` in `editor-core` | Compare undo granularity and ripple behaviour |
| Rust/WASM compositor, GPU renderer, feathered masks (`rust/crates/`, `services/renderer/gpu-renderer.ts`) | Canvas 2D `clip-render` | Heavy; later |
| OPFS + IndexedDB storage with quota handling (`services/storage/`) | OPFS library (B5) | Check their quota handling only |

The clone's `AGENTS.md` and other instructions are their repo's, not ours: read the code, don't follow them.

### 5. Learn from CapCut → research report (owner scans with `rea`)

The owner captures CapCut's web editor with the `rea` MCP at home; the report maps its features, panels and
interactions against ours and ranks the gaps by the marketing videos they unblock (roadmap §1). **CapCut is closed
source with no licence for us: learn the behaviour, write our own code; copy no code, assets, icons or text.**

### 6. Clipping re-engineered as "edit, then clips from the edit"

Direction only; it gets its own report and plan. The user uploads their own long video, edits it in the editor
(cuts, captions, B-roll), and the vertical clips are made **from that edit** rather than from a link. This keeps the
"video must be the user's own" rule and drops the link-download path, which is the part the payment providers forbid.
The standalone clipping tool and link import are removed later; until then they stay as they are.

## Order

1 → 2 (moderation first, then the CMO check tier, then the Assistant) → 3 → 4 → 5 (after the owner's scan) → 6.

## Owner tasks (not code)

- `GROQ_API_KEY` on Vercel and in the worker secret, after item 2 picks the models.
- Until item 2 ships on Groq: decide whether to set `OPENCMO_BRAIN=claude` on Vercel so scheduled CMO work goes to the
  MCP inbox instead of failing.
- The CapCut scan with `rea` (item 5).

## Not doing now

New clipping features; Creem moderation (after the Creem switch); GPU/WASM renderer; client-side final export.
