---
name: security-review-checklist
description: Use when reviewing a diff or PR in this repo for security or correctness (including /code-review and /security-review runs), and before opening a PR that touches secrets, SQL migrations, credits, the worker's media pipeline, MCP tools or rate limits. Lists the checks that found real bugs on 2026-10-21.
---

# Security review checklist

Each check below found a real bug in the review of #93 (2026-10-21). Run them on every diff that touches the area,
then the generic review.

| Check | What to look for | Skill |
|---|---|---|
| Secrets go to the right host | A key chosen from one URL but sent to another; a `a or b` fallback between two vendors' keys; a key in a log or error | `llm-provider-keys` |
| Applied migrations are never edited | `git log` on every changed file under `supabase/migrations/`: any commit before this PR's means it merged, so the change belongs in a new migration | `supabase-migrations` |
| New tables are reachable and no wider than needed | `create table` without `grant` in the same migration (unreachable after 2026-10-30); a grant wider than RLS and the RPCs need | `supabase-migrations` |
| Refunds are provable | A refund on rows that can't prove the work was in flight; credits moved outside `credit_*` / `refund_job` | `supabase-migrations` |
| User media can't exhaust the worker | A decode/encode of user media with no size or thread cap; no before/after peak RSS in the PR | `ffmpeg-ram-budget` |
| Limits come before the expensive part | A rate limit checked after reads, writes or worker calls it is meant to bound (`apps/web/lib/mcp/look.ts` runs `ensureProject` before `rate_limit_hit`) | — |

## How to report

- Trace a real path from a caller or input to the failure, with concrete env/data ("`GROQ_API_KEY` set,
  `CMO_AGENT_SALES_BASE_URL=https://openrouter.ai/api/v1`, no own key → the Groq key goes to OpenRouter").
- Reproduce before fixing: a failing test, or a measurement for resource bugs.
- Say what depends on production state you can't see (which migration version ran, which env is set), and give the
  owner the read-only query or check that settles it.
- Separate "fails closed after this fix" from "breaks": a fix that stops a misconfigured agent is a deploy note.
