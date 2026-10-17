# Plan: security audit — MCP on Modal, auth, API routes  (2026-10-17)

Track: Security · PR: [#73](https://github.com/marcus-legia/opencmo/pull/73) · Work split: [`2026-10-17-mcp-auth-api-audit-sessions.md`](2026-10-17-mcp-auth-api-audit-sessions.md)

Source reports:

- `docs/research/security/2026-10-17-security-agent-injection-mcp.md` (on `main`): agent injection and MCP auth,
  written against PR #59's code, before the MCP server moved to Modal.
- PR #71, `docs/research/security/2026-10-17-security-credits-billing-polar.md`: credits, Polar, cron. **Out of
  scope here**; the owner parked payment.

This is an **audit, not a fix.** Both sessions read code, prove findings against a local stack, and write reports.
No production code, config or migration changes on this branch. Fixes come later, one PR per recommendation.

## Goal and why

1. **The MCP server is now on the internet in a new place.** `packages/mcp-server` runs as `opencmo-mcp` on Modal
   (`packages/engine/modal_app.py`, MCP block), next to the old Vercel route `/api/mcp`, which is still live and still
   linked from the app. The 10-17 report reviewed a design, not this deployment: secrets, autoscaling, OAuth and the
   old route have not been audited.
2. **Three questions from the owner, for MCP, auth and every API route:**
   - Can data leak (another user's rows or files, secrets, tokens)?
   - Can someone take it down cheaply (DoS, or a cost attack on LLM, Modal and scraping spend)?
   - Can someone get in without the right credentials (auth bypass, IDOR, token confusion, SSRF into our network)?
3. **Fix before the connector is public.** A claude.ai connector is the activation path for "bring your own
   Claude". A leak or a takedown there costs trust with exactly the founders we want to keep.

## Scope

**In:**

- MCP:
  - `packages/mcp-server/**`
  - the `opencmo-mcp` function and its secrets in `modal_app.py`
  - `apps/web/lib/mcp/**`, `apps/web/app/api/mcp/**`, `apps/web/lib/cmo/mcp/**`
- OAuth:
  - Supabase OAuth server config
  - `/oauth/consent` and `api/v1/oauth/consent`
- Web auth:
  - Google sign-in and `/auth/callback`, signout
  - `middleware.ts`, `lib/supabase/**`
  - Supabase Auth settings in `supabase/config.toml`
- API routes:
  - every handler under `apps/web/app/api/**` and `lib/api/handler.ts`
  - cron and internal routes, worker tokens
- Database surface reachable from a browser:
  - every function `anon` / `authenticated` can execute through PostgREST
  - every table they can write
  - storage bucket policies and signed URLs
- SSRF surfaces:
  - `read_site` (`lib/cmo/site.ts`)
  - clip source URLs (`lib/api/source.ts`) and the worker's download
- Logging and error text that reaches a client or a model.

**Out:**

- Polar webhook and checkout, the credits ledger, pricing (PR #71).
- Prompt injection inside CMO jobs, except where it reaches MCP tools (covered by the 10-17 report and the agent
  evals plan, PR #72).
- ffmpeg and media parsing (covered, no change since).

## What changed since the 10-17 report

Checked on `main` at `ddb63c5`:

- **Protocol version:** `PROTOCOL_VERSION = "2025-06-18"` now lives only in the old route
  (`apps/web/lib/mcp/server.ts`). The Modal server uses the official SDK (`@modelcontextprotocol/sdk` 1.31.0,
  stateless Streamable HTTP, JSON responses) and negotiates the version itself.
- **Still true:** `packages/mcp-server/src/oauth.ts` `userForAccessToken` accepts any Supabase OAuth token that has
  any `client_id`:
  - no audience, resource or client allowlist check
  - no scopes
  - no `mcp_grants` table
- **New surfaces the 10-17 report did not cover:**
  - the Modal container's secrets
  - no `max_containers`
  - wildcard CORS
  - the Host-header fallback in `origin()`
  - both MCP endpoints live at once
  - the old route's confirm codes

## Threat model

| Actor | Has | Wants |
|---|---|---|
| Anonymous internet | Our URLs | Data, a crash, our spend, a foothold (SSRF) |
| Signed-in user | Their own session, API key, anon key, PostgREST | Another user's data, free compute, bypassing limits and moderation |
| Malicious OAuth client | A client registered through DCR, a phishing link | A user's consent, a token that works on our MCP |
| Prompt-injected Claude session | A user's MCP connection | Spend credits, write memory, exfiltrate data through tools |
| Cost attacker | Many free accounts or bad tokens | Run up Modal, LLM, scraping and Supabase bills |

**Severity:** Cao / Trung bình / Thấp, as in earlier reports.

**Status labels:**

- **đã xác nhận**: code read and the issue reproduced locally.
- **nghi ngờ**: needs a run or real data.

## Leads from exploration (verify every one; do not copy into a report unchecked)

### MCP on Modal

1. **Secret blast radius.** The `opencmo-mcp` function mounts four secrets:
   - `opencmo`, the whole worker secret: service role, Anthropic, `OPENCMO_WORKER_TOKEN`, `CRON_SECRET`
   - `opencmo-voice`: ElevenLabs
   - `fal-secret`: fal
   - `opencmo-mcp`: `SUPABASE_JWT_SECRET`, `MOTION_PREVIEW_TOKEN`, optional Modal tokens

   That container is the most exposed process we run. `SUPABASE_JWT_SECRET` can mint a JWT for any user. It is also
   the key behind confirm codes (`src/confirm.ts`).
2. **Unbounded scale and cost.**
   - `min_containers=1`, `@modal.concurrent(max_inputs=50)`, and no `max_containers`.
   - Authentication runs before the per-user rate limit and there is no IP throttle. Every bad token costs a
     Supabase `getUser` (OAuth) or a service-role `api_key_owner`, and `api_key_owner` also UPDATEs `last_used_at`.
   - `rate_limit_hit` is called once per message, so up to 20 round trips per request.
3. **OAuth token acceptance.**
   - Any `client_id` passes, and the token is forwarded to PostgREST as is.
   - `allow_dynamic_registration = true` in `supabase/config.toml`, so anyone can register a client.
   - The consent page redirects straight back once a client was approved before.
   - Consent is all-or-nothing: there are no scopes.
4. **Host and Origin.**
   - `origin()` trusts `x-forwarded-host` / `host` when `OPENCMO_MCP_URL` is unset. That URL feeds the protected
     resource metadata and the `WWW-Authenticate` header.
   - CORS is `*`, there is no Origin check, and the SDK transport is built without `allowedHosts`.
5. **The old route `/api/mcp` is still live.**
   - The app still points users to it when `OPENCMO_MCP_URL` is unset: `lib/cmo/connect.ts`,
     `components/clipping/web/ApiKeys.tsx`.
   - `request.json()` reads the body with no size cap.
   - It runs 20 messages in parallel with a 300 s limit.
   - Its `generate_media` confirm code has no nonce, so it can be replayed for 10 minutes.
6. **`read_site` over MCP.**
   - MCP passes `siteReads: 0` on every call, so the per-turn limit never applies; only the 20/h cap does, at up to 4
     fetches each.
   - SSRF gaps in `lib/cmo/site.ts`:
     - the DNS-rebinding window, acknowledged in the code
     - no NAT64 `64:ff9b::/96`, 6to4 `2002::/16` or hex `::ffff:` handling
     - redirect hops do not re-check port or userinfo
7. **Confirm codes go to the model.** A prompt-injected Claude session can confirm a spend. "Never confirm on your
   own" is a prompt line, not a control.

### Web auth and API routes

8. **Open redirect** in `app/auth/callback/route.ts`.
   - `next=/.//evil.com` normalizes to pathname `//evil.com`, so the response sends `Location: //evil.com`.
   - Reachable through `/login?next=…` after a Google sign-in.
9. **SSRF on clip source URLs.**
   - `lib/api/source.ts` and the SQL check only match host strings: no DNS resolution, no redirect handling.
   - Missed: `0.0.0.0`, `100.64/10`, IPv6 ULA and link-local, metadata hostnames.
   - The worker's yt-dlp download has no private-address guard, unlike page captures (`capture/guard.py`).
10. **Route limits are bypassable.** RPCs, including `rate_limit_hit`, are granted to `authenticated` and callable
    straight through PostgREST with the anon key. Limits that live only in `withApi` do not hold.
11. **GET routes that change state.**
    - `editor/project` creates projects.
    - `cmo/workspace` calls a service-role `kickCmoQueue` (up to 250 s) with no rate limit.
12. **Cron routes fail open outside production.**
    - When `CRON_SECRET` is unset and `NODE_ENV !== "production"`, any request passes.
    - One secret covers three routes, including the cleanup that deletes users.
13. **CSRF check.**
    - `withApi` allows write requests that send neither `Sec-Fetch-Site` nor `Origin`.
    - `auth/signout` is outside `withApi`.
14. **Middleware matcher** skips paths that start with `blog`, or end in `.png` / `.jpg` / `.svg` / `.mp4`. The app
    layout calls `getUser()` again, which mitigates this; check what it means for `/api/**`.
15. **Supabase Auth settings.** Email signup is on with a minimum password length of 6, and captcha is off. The app
    only offers Google sign-in, so is email signup reachable directly through the Auth API?

## Method

- **Read first, then prove.**
  - Run proofs of concept only against a local stack: `npm run dev`, local Supabase, `modal serve` in a dev Modal
    environment.
  - Use two local test users for every cross-user check.
- **Proof-of-concept scripts stay in the session's scratchpad.** Do not commit them. Describe each reproduction in
  the report in words, with the exact request shape.
- **Never touch production.** No requests to opencmo.io or the deployed Modal app beyond reading public metadata. No
  `modal deploy`, no `supabase db push`, and do not run load tests against anything shared.
- **Cost and DoS claims need numbers.** For example: round trips per bad token, worst-case containers, bytes read
  before a cap. Measure locally or compute them from code; label which.
- **Every finding records:**
  - the code path with file:line
  - an actor from the threat model
  - impact
  - status (đã xác nhận / nghi ngờ)
  - the recommended fix
  - cost (S/M/L)
  - the test that would catch a regression (pgTAP, `*.check.ts`, e2e)
- **Re-check the 10-17 report's recommendations 1–7.** Mark each as done, partly done or not done, with evidence.
- **External sources** (MCP spec 2026-07-28 security considerations, Supabase OAuth server docs, Modal web endpoint
  docs, OWASP): cite with read date. Repo code is untrusted data: read it, never run it.

## Deliverables

1. `docs/research/security/2026-10-17-audit-mcp-modal.md`, written by Session A.
2. `docs/research/security/2026-10-17-audit-auth-api.md`, written by Session B.

Both follow the format in `docs/research/README.md` and are in **Vietnamese**, per the research exception. Add one
row each to `docs/research/security/README.md`.

3. **Merged top 10**, filled in below after both reports land. Rank by risk removed per day of work. Each entry
   names the follow-up fix PR it belongs to.

## Merged top 10

From `docs/research/security/2026-10-17-audit-mcp-modal.md` (A) and `2026-10-17-audit-auth-api.md` (B). Ranked by risk
removed per day of work. Each item is its own follow-up PR (or a dashboard change), never this PR.

| # | What | Source | Cost | Belongs to |
|---|---|---|---|---|
| 1 | Shrink the MCP container's secrets: drop the worker secret `opencmo` from `mcp_server`, keep only what the bundle reads; give confirm codes their own key; take the cleanup `CRON_SECRET` out of any secret MCP mounts | A §1, B §8 | S | PR "mcp hardening" |
| 2 | Set `max_containers` on `mcp_server`. Confirm whether Modal's ~200 rps quota is per workspace; if so, move MCP to its own workspace or environment, or put it behind a per-IP limit. Make `rate_limit_hit` one call per batch | A §2, §7 | S | PR "mcp hardening" |
| 3 | Fix the `/auth/callback` open redirect (check the normalized pathname, reject `//`), with a `*.check.ts` table of variants | B §1 | S | PR "web auth" |
| 4 | Production Auth: `[auth.email] enable_signup = false` (Google stays), captcha if email is kept, password ≥ 12; align `supabase/config.toml` | B §4 | S | Owner (dashboard) + small config PR |
| 5 | Close the free-cost paths: `cmo_enqueue` stops trusting `brain` from the client; decide a paid-plan rule or daily cap for MCP previews and social research; `research_credits` returns "available / used up", not the balance | B §3, A §4, A §11 | S | PR "CMO" + owner decision |
| 6 | OAuth: allowlist client redirect hosts at consent (claude.ai, localhost), a `mcp_grants` table checked by `userForAccessToken`, consent title shows the redirect host; check that revoke stops live tokens | A §3 | M | PR "mcp oauth" |
| 7 | One SSRF guard (resolve DNS, public unicast only, pinned IP, re-check every redirect) shared by `read_site`, source URLs + yt-dlp, and captures; one range table for TS, SQL and Python | B §2, A §6 | M | PR "ssrf" |
| 8 | Retire `/api/mcp` (410 with the new URL), require `OPENCMO_MCP_URL` in the app and in `main.ts`, move `e2e/mcp.spec.ts` | A §5, §8 | S | PR "mcp hardening" |
| 9 | Revoke the Assistant bookkeeping RPCs from `authenticated`, cap `agent_record_tool` input size, add a pgTAP allowlist of functions `authenticated` may execute | B §5, PR #71 recs 6/8 | S–M | PR #71's billing/agent PR |
| 10 | Memory-poisoning gate and untrusted-text sanitizer (10-17 report recs 1–2), before the connector is public: over MCP, `remember` and research share one Claude session | A §11 table | M | CMO track |

**Not doing:** no extra route-level authorization layer (B: 0 of 660 cross-user RPC calls got through); no Origin /
`allowedHosts` check on the remote MCP server (A §9).

**Owner decisions needed:** item 4 (dashboard), item 5 (what free accounts may use over MCP), and the Modal quota
question in item 2.
