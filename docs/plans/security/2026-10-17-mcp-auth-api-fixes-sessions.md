# Security fixes (MCP, auth, API): work split for three sessions, one PR

Plan: [`2026-10-17-mcp-auth-api-fixes-plan.md`](2026-10-17-mcp-auth-api-fixes-plan.md). Read all of it first.
Branch: **`plan/security/2026-10-17-mcp-auth-api-fixes`** · PR: [#74](https://github.com/marcus-legia/opencmo/pull/74) (draft), shared by all three sessions.

Three Claude Code sessions build this in parallel on the same branch:

- **Session A — MCP platform & Modal**: fixes 1, 2 and 8, plus the MCP side of fix 5.
- **Session B — Auth, OAuth & plans**: fixes 3, 4, 5 and 6.
- **Session C — SSRF, DB grants & memory**: fixes 7, 9 and 10.

## Rules for all sessions

1. **Own your paths.** Edit only the paths listed for your session. If you need a change in another session's paths,
   write it under "Requests" below and let them make it.
2. **Same branch, no force.**
   - Run `git pull --rebase origin plan/security/2026-10-17-mcp-auth-api-fixes` before every push.
   - Never use `--force`, never rebase pushed commits, never push to `main`.
3. **Small commits.**
   - Prefix each commit with `[A]`, `[B]` or `[C]`.
   - Write commit messages in English.
   - Each commit must be green on its own: typecheck plus the tests of what it touches.
   - End each commit with the attribution lines your tooling gives you.
4. **Update your checklist** in this file, in the same commit that finishes the item. Edit only your own section.
5. **Repo rules still apply** (CLAUDE.md):
   - Every write goes through an ownership-checking RPC.
   - Money only moves through the credit module.
   - Every migration has a pgTAP test. Run `scripts/dump-schema.sh` after it; on a `supabase/schema/current.sql`
     conflict, regenerate instead of merging by hand.
   - English everywhere, including SQL `raise exception` text, route errors and MCP error messages. Translate
     Vietnamese comments in lines you touch.
   - Comments explain why.
   - Pipeline budgets: peak RAM < 2 GB, 45-minute video → 5 clips in < 3 minutes. C must measure if the yt-dlp path
     changes.
6. **Numbering, so files don't collide:**

   | Session | Migration timestamps | pgTAP files |
   |---|---|---|
   | A | `202612100…` | `170`–`174` |
   | B | `202612101…` | `175`–`179` |
   | C | `202612102…` | `180`–`189` |

7. **Heavy suites one at a time:** `db:reset`/`db:test`, `npm run build`, e2e, engine pytest.
8. **Do not deploy.** No `modal deploy`, no `supabase db push`, no dashboard changes. Those are the owner tasks O1–O4
   in the plan. Write the exact steps in the PR body instead.
9. **Security fixes need the failing test first.** Write the check named in the plan, see it fail on the current code,
   then fix.

## Shared contracts

Land these first; others code against them, and they change only through a "Requests" note.

```sql
-- B1 — supabase/migrations/202612101…_is_paid.sql
create function public.is_paid(p_user uuid) returns boolean   -- plan in ('starter','creator'); false for other users' ids when called by authenticated
```

```ts
// B1 — apps/web/lib/pricing.ts
export function isPaidPlan(plan: string | null | undefined): boolean;
```

```sql
-- A1 — supabase/migrations/202612100…_mcp_admit.sql (uses B1's is_paid)
create function public.mcp_admit(p_count integer) returns text  -- 'ok' | 'free_plan' | 'rate_limited'; p_count 1..20
```

```ts
// A1 — packages/mcp-server/src/http.ts
export const PAID_PLAN_ERROR = { code: -32003, message: "OpenCMO's MCP connection is part of the paid plans. Upgrade on the Credits page." };
```

```ts
// C1 — packages/contracts/private-addresses.json
[{ "input": "0.0.0.0", "blocked": true, "why": "unspecified" }, ...]

// C1 — apps/web/lib/net/address.ts
export function privateAddress(ip: string): boolean;
export function blockedName(host: string): boolean;
export function checkUrl(url: URL): { host: string; port: number } | { refused: string };
```

B1 must land before A1's migration. A can write the TypeScript side of A1 against the signature at once.

## Session A — MCP platform & Modal

**Owns:**

- `packages/mcp-server/**`, except `src/oauth.ts` (B)
- `packages/engine/modal_app.py`, plus a new `packages/engine/mcp_app.py` if you split the MCP app out
- `packages/engine/tests/test_modal_secrets.py`
- `apps/web/lib/mcp/**`, `apps/web/app/api/mcp/**`
- `apps/web/lib/cmo/connect.ts`
- `apps/web/components/clipping/web/ApiKeys.tsx`, the endpoint fallback only. B owns the free-plan UI in the same
  file: A edits lines 60–70, B the rest; announce your edits under Requests.
- `apps/web/e2e/mcp.spec.ts`
- `apps/web/app/api/cron/cleanup/**`
- `apps/web/lib/modal.ts`, `apps/web/lib/generate/models.ts` (voice flag)
- A's migrations

Checklist:

- [ ] **A1 — Contracts.**
  - `mcp_admit` migration and pgTAP: bounds, free plan, 601st message, other users unaffected.
  - `PAID_PLAN_ERROR`.
  - `http.ts` calls `mcp_admit` once per request: a free user gets 403, a rate-limited one 429.
  - `api_key_owner` writes `last_used_at` at most every 5 minutes.
  - **Accept:** pgTAP green; `npm run test --workspace @opencmo/mcp-server` has a case "batch of 20 → one admission
    call" and the 403 body.
- [ ] **A2 — Secrets out of the MCP container (fix 1).**
  - The MCP app lives in its own file and Modal workspace, with only the `opencmo-mcp` secret.
  - Confirm-code key `OPENCMO_MCP_CONFIRM_KEY`, fail closed when missing.
  - The worker's `wake` endpoint plus `OPENCMO_WAKE_TOKEN`; `wakeWorker` uses it when it has no worker token.
  - `OPENCMO_VOICE_ENABLED`.
  - `CRON_CLEANUP_SECRET` for the cleanup route and Modal's `cleanup()`.
  - **Accept:**
    - `test_modal_secrets.py` fails on today's `modal_app.py` and passes after.
    - Confirm check without the key fails.
    - The cleanup route refuses `CRON_SECRET`.
    - `modal serve` (dev workspace) of both apps starts.
    - The deploy steps for O2 are written in the PR body.
- [ ] **A3 — Flood cap (fix 2).** `max_containers=3` on `mcp_server`, with the reason (workspace quota) in a comment.
  - **Accept:** `test_modal_secrets.py` also asserts `max_containers`.
- [ ] **A4 — Retire `/api/mcp` (fix 8).**
  - The route returns 410 with the new URL.
  - Delete `lib/mcp/server.ts`.
  - `connect.ts` and `ApiKeys.tsx` stop falling back to the old URL.
  - `main.ts` exits when public and `OPENCMO_MCP_URL` is unset.
  - `mcp.spec.ts` runs against the local Modal server, with a paid user plus one free-user case.
  - **Accept:** e2e green; `/api/mcp` returns 410; `npm run typecheck` and `npm run build` pass.

## Session B — Auth, OAuth & plans

**Owns:**

- `apps/web/app/auth/**`, `apps/web/lib/auth/**`
- `supabase/config.toml`
- `apps/web/app/oauth/**`, `apps/web/app/api/v1/oauth/**`
- `apps/web/components/clipping/web/ConnectedApps.tsx`, and the free-plan parts of `ApiKeys.tsx`
- `packages/mcp-server/src/oauth.ts`
- `apps/web/lib/pricing.ts`
- `apps/web/lib/agent/cmo-research.ts` (`research_credits` only)
- `apps/web/lib/cmo/mcp/inbox.e2e.ts` (test user's plan)
- a new `apps/web/scripts/check-auth-signup.mjs` and its `package.json` script line
- B's migrations

Checklist:

- [ ] **B1 — Contracts.** `is_paid` migration plus pgTAP; `isPaidPlan()`. Push this first.
- [ ] **B2 — Open redirect (fix 3).** `lib/auth/next.ts` `safeNext` plus `next.check.ts` with the plan's table, then
  `auth/callback/route.ts` uses it.
  - **Accept:** the check fails on today's logic (copy the old expression into the test as the "before" case) and
    passes with `safeNext`; `/auth/callback?code=…&next=/.//evil.example` redirects to `/app`.
- [ ] **B3 — Email signup off (fix 4).** `config.toml` email signup off, password length 12;
  `check-auth-signup.mjs`.
  - **Accept:** on the local stack, signup returns 4xx; the full e2e suite stays green, because users come from
    `admin.createUser`.
- [ ] **B4 — Free accounts (fix 5, all but the MCP gate):**
  - `create_api_key` refuses free users.
  - `/oauth/consent` and `api/v1/oauth/consent` refuse free users, with the upgrade message.
  - `cmo_enqueue` charges `brain = 'claude'` unless the user is paid.
  - `research_credits` returns `{ available }`.
  - Settings shows the upgrade CTA in API keys and Connected apps.
  - The MCP e2e (`inbox.e2e.ts`) sets plan `starter`.
  - **Accept:** pgTAP for all three SQL changes; typecheck; the e2e on Settings shows the CTA for a free user.
- [ ] **B5 — OAuth (fix 6).**
  - Redirect host allowlist on the consent page and route; title shows the host.
  - `mcp_grants`, `mcp_grant_record` and `mcp_grant_revoke`, with pgTAP.
  - The consent route records the grant on approve; ConnectedApps revokes both.
  - `oauth.ts` requires an active grant.
  - **Accept:** pgTAP; `server.check.ts` case "valid getUser, no grant → 401" (add it through a Requests note to A,
    or in a B-owned check file next to `oauth.ts`); an e2e that a non-allowlisted redirect host cannot approve.

## Session C — SSRF, DB grants & memory

**Owns:**

- `packages/contracts/private-addresses.json`
- `apps/web/lib/net/**`
- `apps/web/lib/cmo/site.ts`, `apps/web/lib/api/source.ts`
- `packages/engine/opencmo/{worker/media.py, steps/download.py, capture/**}`
- `packages/engine/tests/test_addresses.py`, plus new engine tests for the guard
- `apps/web/lib/agent/{loop,scope,session,cmo-tools}.ts`, `apps/web/app/api/v1/agent/**`
- `apps/web/lib/cmo/untrusted.ts`, `apps/web/lib/cmo/social/**`, `apps/web/lib/cmo/jobs/{sales-scan,context}.ts`
- `apps/web/lib/cmo/mcp/cmo.ts` (`remember` passes `'agent'`)
- C's migrations

Checklist:

- [ ] **C1 — Contracts.** The shared fixture; `lib/net/address.ts` with `address.check.ts` reading the fixture;
  `test_addresses.py` reading the same fixture.
  - **Accept:** both checks green on the full table. Push this first.
- [ ] **C2 — Web side of fix 7.**
  - `site.ts`: `checkUrl` on every hop, an undici `Agent` pinning the checked IP.
  - `source.ts`: `blockedName` / `checkUrl` / literal-IP check.
  - A new `create_job` regex migration with pgTAP reading the fixture's URL cases.
  - **Accept:** `site.check.ts` and `source.check.ts` refuse every fixture "blocked" case and accept the public
    controls; pgTAP green.
- [ ] **C3 — Worker side of fix 7.**
  - `validate_public_url` uses `addresses.py`, ports 80/443 only.
  - yt-dlp goes through `GuardProxy` when `cfg.proxy` is unset.
  - Document the IPRoyal case in `download.py`.
  - **Accept:** a pytest where yt-dlp follows a redirect to `127.0.0.1` fails with the guard's refusal;
    `opencmo doctor` and the engine suite pass; `/usr/bin/time -v` on the 54-minute reference video, under the budgets
    and noted in the PR.
- [ ] **C4 — Fix 9.**
  - The four `_for` service-role variants with `p_user`.
  - Revoke the old four from `authenticated`.
  - Size caps.
  - The loop uses the admin client for them.
  - The `authenticated` function allowlist pgTAP.
  - **Accept:** pgTAP (revokes, B §5's early-finish scenario settles, allowlist); Assistant e2e and
    `agent:eval -- --provider fake` green; a note in PR #71 about the overlap.
- [ ] **C5 — Fix 10.**
  - Per-turn taint in `loop.ts`; the gated write tools return the confirm message.
  - `cmo_memories.type 'agent'` and `cmo_remember(p_source)`, with pgTAP.
  - MCP and chat `remember` pass `'agent'`.
  - `untrusted.ts` and its uses (`extractPage` hidden elements, `clean`, `threadBlock`).
  - **Accept:** `untrusted.check.ts`; the `jobs.check.ts` thread-breakout case; an agent eval case (fake provider)
    where `read_site` returns an injected "remember" and no memory is written; pgTAP ordering.

## Requests

_Write requests to another session here: date, from, to, what._
