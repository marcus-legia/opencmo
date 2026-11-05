---
name: llm-provider-keys
description: Use when changing how OpenCMO picks an LLM model or API key — apps/web/lib/cmo/agents/registry.ts, apps/web/lib/agent/model.ts, packages/engine/opencmo/ai/moderation.py, any *_API_KEY env — or before adding a provider. Every model call runs on Claude; a second provider is an owner decision.
---

# LLM provider keys

Every model call runs on Claude (owner, 2026-11-05: one provider, less to manage). Gemini and Groq/OpenAI-compatible
endpoints were removed from the web app and the worker; their keys are read by nothing, and the deploy check notes a
retired key left set (`RETIRED_KEYS` in `packages/engine/opencmo/deploy_env.py`).

## Rules

- Roles: Sonnet for the editor Assistant, CMO chat and every agent that writes or plans (`tier: "draft"`); Haiku for
  small tasks (`tier: "check"`: checker, captions, writer, shorts, moderation). One agent moves with
  `CMO_AGENT_<ID>_MODEL` (a Claude id) and can run on its own key with `CMO_AGENT_<ID>_API_KEY`.
- Do not add another provider, an OpenAI-compatible endpoint or a "fallback vendor" without the owner asking for it.
  If the owner does, a vendor's key goes only to that vendor's endpoint; never fall back to another vendor's key.
- Fail closed. No Anthropic key means an empty `apiKey`: the agent is "not set up", drops out of `agentCandidates`, and
  the caller reports it. Moderation without a key refuses in production.
- Claude out of credit or with a revoked key is UNAVAILABLE, never a content-policy block (`opencmo/ai/moderation.py`).
- The web registry and `packages/engine/opencmo/ai/moderation.py` are twins. Change both in the same PR.
- Keys never leave the server and never appear in logs, errors or `agentTable`.

## Tests, both sides

- `apps/web/lib/cmo/agents/registry.check.ts`: other vendors' keys never move an agent off Claude; the Sonnet/Haiku
  tiers per agent.
- `apps/web/lib/agent/model.check.ts`: the Assistant runs on Claude only; a chat from a removed provider cannot continue.
- `packages/engine/tests/test_ai_moderation.py`: an unpaid or revoked Claude is UNAVAILABLE; other vendors' keys do not
  set up moderation.
