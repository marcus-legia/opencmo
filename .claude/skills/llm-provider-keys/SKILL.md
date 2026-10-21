---
name: llm-provider-keys
description: Use when changing how OpenCMO picks an LLM provider, endpoint or API key — apps/web/lib/cmo/agents/registry.ts, packages/engine/opencmo/ai/moderation.py, openai-compat, any *_API_KEY or *_BASE_URL env — or adding a provider. Keeps a vendor's secret from ever reaching another vendor.
---

# LLM provider keys

A secret goes only to the vendor that issued it. Sending a Groq key to OpenRouter hands Groq credentials to a third
party, and the logs on both sides keep it.

Incident (#94): `GROQ_API_KEY` reached a non-Groq endpoint two ways:
1. `resolveAgent` gave an agent with its own `CMO_AGENT_<ID>_BASE_URL` (and no own key) the shared key chosen for
   `OPENAI_COMPAT_BASE_URL`, not for the URL the request went to.
2. Both the registry's `sharedKey` and the worker's `_compat_key` fell back to `GROQ_API_KEY` on a non-Groq endpoint
   when `OPENAI_COMPAT_API_KEY` was missing (`compat or groq`).

## Rules

- `GROQ_API_KEY` → `GROQ_BASE_URL` only. `OPENAI_COMPAT_API_KEY` → `OPENAI_COMPAT_BASE_URL` only (Groq when unset).
  Any other URL needs the agent's own `CMO_AGENT_<ID>_API_KEY`.
- Pick the key from the URL the request **actually** goes to: `compatKeyFor(url, env)` in
  `apps/web/lib/cmo/agents/registry.ts`. Compare URLs trimmed, without a trailing slash.
- Fail closed. No matching key means an empty `apiKey`: the agent is "not set up", drops out of `agentCandidates`, and
  the caller reports it. Never fall back to another vendor's key to keep a feature running.
- The web registry and `packages/engine/opencmo/ai/moderation.py` are twins. Change both in the same PR.
- Failover (`resolveAgent(id, env, fallback)`) uses the provider's shared URL with its shared key, never an agent's
  own URL or key.
- Keys never leave the server and never appear in logs, errors or `agentTable`.

## Tests, both sides

- `apps/web/lib/cmo/agents/registry.check.ts`: an own non-Groq `BASE_URL` with only `GROQ_API_KEY` gives `apiKey === ""`;
  a non-Groq compat URL with only the Groq key drops `openai` from the candidates; an own URL equal to the compat URL
  gets the compat key.
- `packages/engine/tests/test_ai_moderation.py`: a non-Groq compat URL with only `GROQ_API_KEY` sends no request.
- A test that points a fake local endpoint at `OPENAI_COMPAT_BASE_URL` must set `OPENAI_COMPAT_API_KEY`, not
  `GROQ_API_KEY`. A test that only passed with the Groq key was relying on the leak.
- Write the leak test first and watch it fail.

## Deploy note

Fail-closed changes can stop an agent in production. Before merging, check that every non-Groq endpoint in Vercel,
`opencmo` and `opencmo-mcp` has its own key, and say so in the PR.
