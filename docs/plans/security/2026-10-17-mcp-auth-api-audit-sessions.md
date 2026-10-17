# Security audit (MCP, auth, API): work split for two sessions, one PR

Plan: [`2026-10-17-mcp-auth-api-audit-plan.md`](2026-10-17-mcp-auth-api-audit-plan.md). Read all of it first,
especially "Leads from exploration" and "Method".
Branch: **`claude/security-audit-mcp-auth-7pqvh8`** · PR: [#73](https://github.com/marcus-legia/opencmo/pull/73) (draft), shared by both sessions.

Two Claude Code sessions audit in parallel on the same branch:

- **Session A — MCP & OAuth**: the MCP server on Modal, the old `/api/mcp` route, OAuth and consent, the MCP tools,
  `read_site`.
- **Session B — Web auth, API routes, DB grants**: sign-in, middleware, every `app/api/**` route, cron and worker
  tokens, PostgREST-reachable functions and tables, storage, source-URL SSRF.

## Rules for both sessions

1. **Audit only.** Do not change code, config, migrations or tests. The only files you write are your report, your
   row in `docs/research/security/README.md` and your checklist below.
2. **Own your paths.** If you need something in the other session's files, write it under "Requests" below.
3. **Same branch, no force.**
   - Run `git pull --rebase origin claude/security-audit-mcp-auth-7pqvh8` before every push.
   - Never use `--force`, never rebase pushed commits, never push to `main`.
4. **Small commits.**
   - Prefix each commit with `[A]` or `[B]`.
   - Write commit messages in English.
   - End each commit with the attribution lines your tooling gives you.
5. **Update your checklist** in this file, in the same commit that finishes the item. Edit only your own section.
6. **Local only.**
   - Prove findings against `npm run dev`, local Supabase and `modal serve` in a dev Modal environment.
   - Use two local test users for cross-user checks.
   - Keep PoC scripts in your scratchpad; do not commit them.
   - Never send requests to production.
   - Never run `modal deploy` or `supabase db push`.
   - Do not load-test anything shared.
7. **Heavy suites one at a time** (`db:reset`, `db:test`, `npm run build`, e2e). The two engine tests named in
   CLAUDE.md fail while `npm run dev` runs; that is expected, not a finding.
8. **Report language.**
   - The report and its README row are in **Vietnamese**, per `docs/research/README.md`.
   - This file, the plan and commit messages are in English.
9. **Overlapping findings.** A finding that spans both areas (for example the `rate_limit_hit` grant, or SSRF helpers
   shared by `site.ts` and `source.ts`) is written up by the session whose checklist names it. The other report
   adds a one-line pointer.

## Report skeleton (both sessions)

Use the format in `docs/research/README.md`: TL;DR, Phát hiện, Repo đáng học, Khuyến nghị, Nguồn.

In "Phát hiện", give each finding these fields:

- `[Mức, trạng thái]` title
- code path (file:line)
- actor (from the plan's threat model)
- how it was reproduced locally, or why it could not be
- impact
- the regression test that would catch it

Also add a short section **"Những gì đang làm tốt (để giữ)"**, so a later fix does not undo them.

## Session A — MCP & OAuth

**Owns:**

- `docs/research/security/2026-10-17-audit-mcp-modal.md`
- its row in `docs/research/security/README.md`
- the "Merged top 10" section of the plan file

**Reads:**

- `packages/mcp-server/**`
- `packages/engine/modal_app.py`: the MCP block and the secrets it mounts
- `apps/web/lib/mcp/**`, `apps/web/app/api/mcp/**`, `apps/web/lib/cmo/mcp/**`
- `apps/web/lib/cmo/site.ts`
- `apps/web/app/oauth/**`, `apps/web/app/api/v1/oauth/**`
- `supabase/config.toml`, the `[auth.oauth_server]` section
- `supabase/migrations/*mcp*`, `*api_keys*`

Checklist:

- [x] **A1 — Secret blast radius.**
  - List every env var the `opencmo-mcp` container receives.
  - For each, which code in `packages/mcp-server` (and the bundled `@/` modules) actually needs it.
  - What an attacker gets from a read of `process.env`, or from code execution in that container.
  - Is `SUPABASE_JWT_SECRET` reuse for confirm codes a problem?
  - Recommend the minimal secret set.
  _Done:_ report §1. Bundle env grep: `CRON_SECRET` and Modal tokens unused; JWT secret also keys confirm codes.
- [x] **A2 — Token acceptance.**
  - API keys: format, hash, revocation latency, `last_used_at` write per call.
  - OAuth: what `getUser` proves, what the `client_id` check proves, audience and resource, token passthrough to
    PostgREST, DCR open, consent auto-redirect, no scopes.
  - Can a browser session token, a refresh token or another project's token get through?
  - Test each locally.
  _Done:_ report §3. In-process PoC: any `client_id` passes, session token without one fails; DCR open, client name spoofable on consent.
- [x] **A3 — DoS and cost.**
  - Cost of one unauthenticated or bad-token request: round trips, and DB writes.
  - Worst-case containers without `max_containers`.
  - `max_inputs=50` with requests that run 140 s.
  - The rate-limit loop: 20 RPCs per request.
  - Body and batch caps on the new and the old route.
  - The `mcp_preview`, `mcp_site` and `mcp_social` caps, and whether they hold per account or per key.
  - Free accounts as a multiplier: what signup costs an attacker.
  _Done:_ report §2, §4, §7. Outbound calls per request measured; no `max_containers`; free accounts get previews/research without credits.
- [x] **A4 — Confirm codes.**
  - Replay on the old `/api/mcp` (no nonce): reproduce it locally.
  - The new route's single-use `mcp_confirm_use`.
  - Payload size and inflate limits.
  - The code being visible to the model: what a prompt-injected session can spend in one hour.
  _Done:_ report §5, §10. Old-route replay does not double-charge (`spec_hash` reuse); new route single-use.
- [x] **A5 — Two live endpoints.**
  - Feature and guard drift between `/api/mcp` and Modal.
  - Where the app links each one.
  - What retiring the old one requires.
  _Done:_ report §5. Old route still linked, no body cap (32 MiB parsed in PoC), protocol 2025-06-18.
- [x] **A6 — SSRF in `read_site`.**
  - Every gap: rebinding, NAT64, 6to4, hex `::ffff:`, ports and userinfo on redirect hops, `siteReads: 0` over MCP.
  - What a fetch from the Modal container can reach that a fetch from Vercel cannot.
  - Compare with the worker's `capture/guard.py` and `addresses.py`.
  _Done:_ report §6. NAT64/6to4/`192.0.0.8` pass `privateAddress`; rebinding rationale void over MCP.
- [x] **A7 — Host, Origin, CORS.**
  - The `origin()` fallback on the `x-forwarded-host` / `host` headers.
  - Is `OPENCMO_MCP_URL` guaranteed to be set on Modal?
  - Wildcard CORS with bearer tokens.
  - The SDK's DNS-rebinding options (`allowedHosts`, `allowedOrigins`): do they matter for a remote server?
  - `/` as an alias of `/mcp`.
  _Done:_ report §8, §9. Host-header metadata poisoning only without `OPENCMO_MCP_URL`; CORS `*` fine for bearer.
- [x] **A8 — Tool authorization.**
  - For every tool group (find, studio, generations, explainer, export, guides, cmo, inbox, account): where its IDs
    come from.
  - Does any tool use the service role or `ctx.userId` in a way RLS does not cover? (Example: `kickCmoQueue` from
    `lib/cmo/mcp/cmo.ts`.)
  - Cross-user test with two local users on a sample of each group.
  _Done (code read):_ report §11. All tools under the caller's RLS; service role only in `api_key_owner`. The two-user run was not done here (no local Supabase); repeat it on a machine with `npm run dev`.
- [x] **A9 — Leaks in output.**
  - Error text returned to the model: Supabase messages, stack traces, paths.
  - Signed URLs: lifetime and scope.
  - Logs: tokens, prompts, scene code.
  _Done:_ report §11. Tool errors sanitized; export links 5 minutes; no tokens in logs.
- [x] **A10 — 10-17 report status.** For recommendations 1–7: done, partly done or not done, each with evidence.
  _Done:_ report, table "Trạng thái khuyến nghị": recs 1–4 and 6 not done, 5 partly.
- [ ] **A11 — Merged top 10.** After "B done" appears under Requests, fill in the plan's last section from both
  reports.

## Session B — Web auth, API routes, DB grants

**Owns:**

- `docs/research/security/2026-10-17-audit-auth-api.md`
- its row in `docs/research/security/README.md`

**Reads:**

- `apps/web/app/auth/**`, `apps/web/app/login/**`, `apps/web/components/LoginForm.tsx`
- `apps/web/middleware.ts`, `apps/web/lib/supabase/**`, `apps/web/lib/api/**`
- `apps/web/app/api/v1/**`, `apps/web/app/api/cron/**`, `apps/web/app/api/internal/**`
- `apps/web/lib/cron-auth.ts`, `apps/web/lib/storage.ts`, `apps/web/next.config.ts`
- `supabase/migrations/**` (grants, RLS, storage policies)
- `supabase/config.toml`, the `[auth]` section
- `packages/engine/opencmo/steps/download.py`
- `packages/engine/opencmo/worker/cmo_dispatch.py`

Checklist:

- [x] **B1 — Open redirect.**
  - Reproduce `next=/.//evil.com` and its variants locally through `/login` and Google sign-in, or by calling the
    callback directly with a valid code.
  - List every other place that reads `next`, `redirect_to`, `returnTo` or `url`.
- [x] **B2 — IDOR sweep.**
  - Every `[id]` and `[kind]` route, every signed-URL route.
  - Brand-kit logo path, uploads reservation.
  - As user 2, ask for user 1's objects. Record status codes and bodies.
- [x] **B3 — PostgREST surface.**
  - With SQL on local Supabase, list:
    - every function where `has_function_privilege('anon' | 'authenticated', oid, 'execute')` is true
    - every table with an INSERT, UPDATE or DELETE grant or policy for those roles
  - Mark each function as intended or not.
  - Find which route limits, moderation steps or ownership checks a direct call skips. Include `rate_limit_hit`
    itself: can a user exhaust or reset their own or anyone's bucket?
  - Coordinate with PR #71 finding 6 (`create_generation`): point to it, do not repeat it.
- [x] **B4 — SSRF on source URLs.**
  - `lib/api/source.ts` plus the SQL check against: a DNS name pointing at 127.0.0.1, `0.0.0.0`, `100.64/10`,
    `[fd00::]`, `metadata.google.internal`, redirects.
  - What the worker's yt-dlp would fetch, and what that reaches on Modal.
- [x] **B5 — CSRF.**
  - Writes with neither `Sec-Fetch-Site` nor `Origin`: which clients send that, and does it matter given SameSite=Lax?
  - State-changing GETs: `editor/project`, `cmo/workspace`.
  - `auth/signout`.
- [x] **B6 — DoS and cost.**
  - Routes with LLM, Modal or service-role work and no limit: `cmo/workspace` → `kickCmoQueue`, agent turns,
    `captions/translate`, onboarding.
  - Body caps outside `withApi`.
  - Middleware `getUser()` on every request.
  - Fixed-window limit bursts (2× at the boundary).
  - Estimate what one account and 100 free accounts cost per hour.
- [x] **B7 — Cron, internal and worker tokens.**
  - Fail-open outside production.
  - One `CRON_SECRET` for three routes.
  - How Modal calls Next.js (`cmo_dispatch.py`).
  - `OPENCMO_WORKER_TOKEN` and `MOTION_PREVIEW_TOKEN` checks: timing-safe? Sent in the body or a header?
- [x] **B8 — Supabase Auth settings.**
  - Can someone sign up by email/password straight through `/auth/v1/signup`, even though the UI only offers Google?
  - Password length 6, captcha off, auth rate limits, JWT expiry and refresh rotation.
  - What a mass-signup attacker gets: free credits? Check the signup grant without going into billing.
- [x] **B9 — Headers and leaks.**
  - CSP (`unsafe-inline`), HSTS, `frame-ancestors`, the sandbox page.
  - Error text in route responses and in `jobs.error`.
  - `NEXT_PUBLIC_*` values.
  - The Polar webhook's 401 `reason` (note only; billing is out of scope).
  - Sentry: what gets sent.
- [x] **B10 — Storage.**
  - Every bucket's policies.
  - Path rules in `lib/storage.ts` (`..`, `/proxy/`).
  - Delete policies: can a user delete a source a running job needs?
  - Signed URL TTLs.
- [x] **B11 — Middleware matcher.**
  - Prefix bypasses (`/blogX`, `/app/x.png`): what each one skips.
  - Confirm `/api/**` never depends on middleware for auth.
- [x] **B12 — Done.** Post "B done" under Requests so Session A can write the merged top 10.

## Requests

_Write requests to the other session here: date, from, to, what._

- 2026-10-17, A → B: pointers from `docs/research/security/2026-10-17-audit-mcp-modal.md` for your report:
  - B3: a Supabase OAuth access token is a full `authenticated` JWT, so any approved OAuth client can call PostgREST
    directly, not only MCP (A §3). Include it when you list the PostgREST surface.
  - B3: `enqueue_cmo_run` accepts `brain: "claude"` from the user (price 0), by design (A §11). Check it against the
    daily caps.
  - B4: share one private-address table with `read_site` (A §6: NAT64, 6to4, `192.0.0.0/24` missing in
    `lib/cmo/site.ts`).
  - B1: the OAuth consent flow sends signed-out users to `/login?next=/oauth/consent…`, so the open redirect also
    sits on the connector path.
  - B8: what direct email signup costs feeds A §4 (free accounts using MCP previews/research).
- 2026-10-17, B → A: **B done.** Report: `docs/research/security/2026-10-17-audit-auth-api.md`. Your five pointers are
  in it (B1 §1, B3 §3 and §12, B4 §2, B8 §4). For the merged top 10: B §1 open redirect (S), B §4 email signup off (S,
  dashboard), B §3 `brain` from client (S), B §2 shared SSRF guard (M, with A §6), B §5 revoke agent bookkeeping RPCs
  (with PR #71), B §8 split the cleanup `CRON_SECRET` out of the Modal secret (with A §1).
